import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { AuditLogService } from '../common/audit-log.service';
import { EmailTemplateService } from '../email-template/email-template.service';
import { presenterFee } from './pricing.constant';
import { applyUniqueCode } from './unique-code.util';
import { generateInvoicePdf } from './invoice-pdf.util';
import { Ocs2SyncService } from './ocs2-sync.service';

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private auditLog: AuditLogService,
    private emailTemplate: EmailTemplateService,
    private ocs2Sync: Ocs2SyncService,
  ) {}

  // Ketentuan Biaya Presenter Berkelompok: HANYA submitter paper yang
  // dikenakan biaya (member/non-member), penulis lain (co-author) tidak
  // dikenakan biaya sama sekali — KECUALI:
  //   (a) payment_override di baris submitter ("non_payment"/"writer")
  //       = submitter di-waive, fee-nya 0.
  //   (b) manual_fee di baris writer MANAPUN (submitter atau bukan) =
  //       admin sengaja set nominal spesifik buat orang itu — dipakai
  //       kasus "anggota presenter yang MINTA SENDIRI ikut bayar biar
  //       dapat sertifikat sendiri" (bukan aturan umum, permintaan
  //       per-paper). manual_fee SEKALI diisi, backend nolak diubah lagi
  //       (lihat updateWriters) — sengaja gak ada revisi.
  // Cari writer yang match submitter (by user_id, fallback email).
  private async findSubmitterWriter(paperId: string) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      select: { submitter_id: true },
    });
    const writers = await this.prisma.paper_writers.findMany({
      where: { paper_id: paperId, role: 'presenter' },
    });
    let submitterWriter = writers.find((w) => w.user_id === paper?.submitter_id);
    if (!submitterWriter && paper?.submitter_id) {
      const submitter = await this.prisma.users.findUnique({ where: { user_id: paper.submitter_id } });
      submitterWriter = writers.find((w) => w.email === submitter?.email);
    }
    return { writers, submitterWriter: submitterWriter ?? null };
  }

  private effectiveFee(
    writer: { member_status: boolean | null; payment_override: string | null; manual_fee: unknown },
    isSubmitter: boolean,
  ): number {
    if (writer.manual_fee != null) return Number(writer.manual_fee);
    if (isSubmitter && !writer.payment_override) return presenterFee(writer.member_status);
    return 0;
  }

  // Total = jumlah effectiveFee semua writer (biasanya cuma submitter yang
  // nonzero, tapi manual_fee bisa bikin writer lain ikut nonzero juga).
  // Return null kalau submitter nggak ketemu DAN nggak ada satupun
  // manual_fee yang di-set — biar dicek manual, bukan ditebak (submission
  // proxy/tim). Kalau ada manual_fee walau submitter nggak ketemu, tetap
  // dihitung dari situ — orang yang manual_fee-nya di-set emang beneran
  // mau bayar segitu, lepas dari status submitter papernya.
  private computeTotal(writers: { member_status: boolean | null; payment_override: string | null; manual_fee: unknown; writer_id: string }[], submitterWriter: { writer_id: string } | null) {
    const hasManualFee = writers.some((w) => w.manual_fee != null);
    if (!submitterWriter && !hasManualFee) return null;
    return writers.reduce((sum, w) => sum + this.effectiveFee(w, w.writer_id === submitterWriter?.writer_id), 0);
  }

  // payments.total_amount NULL = trigger DB baru bikin baris placeholder
  // (paper baru di-accept), belum dihitung.
  private async ensureCalculated(payment: any) {
    if (payment.total_amount != null || !payment.paper_id) return payment;
    const { writers, submitterWriter } = await this.findSubmitterWriter(payment.paper_id);
    const total = this.computeTotal(writers, submitterWriter);
    // sendInvoiceTeam sudah otomatis nolak dgn "Nominal belum bisa
    // dihitung" kalau total null, jadi ketahuan perlu dicek manual.
    if (total == null) return payment;
    const updated = await this.prisma.payments.update({
      where: { payment_id: payment.payment_id },
      data: { total_amount: total, payment_status: 'waiting for payment' },
    });
    // Push balik ke ocs2 biar peserta yang masih cek status bayar di
    // sistem lama juga langsung lihat nominal yang benar. Match pakai
    // paper_id, BUKAN payment_id (lihat komentar di ocs2-sync.service.ts).
    await this.ocs2Sync.pushPaymentTotalByPaperId(payment.paper_id, total, 'waiting for payment');
    return updated;
  }

  // Detail per-paper: breakdown tiap writer + fee masing-masing, buat
  // halaman edit admin (mirip PaymentDetails.vue di ocs2).
  async paperDetail(paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { payment_id: paymentId },
      include: { papers: { include: { paper_writers: { orderBy: { writer_order: 'asc' } } } }, users: true },
    });
    if (!payment) throw new NotFoundException('Payment tidak ditemukan');
    const calculated = await this.ensureCalculated(payment);
    const paper = payment.papers;
    const submitterEmail = payment.users.email;

    const writers = (paper?.paper_writers ?? []).map((w) => {
      const isSubmitter = w.user_id === payment.submitter_id || w.email === submitterEmail;
      return {
        writerId: w.writer_id,
        name: `${w.first_name} ${w.last_name}`,
        role: w.role,
        isMember: w.member_status,
        paymentOverride: w.payment_override,
        manualFee: w.manual_fee != null ? Number(w.manual_fee) : null,
        fee: this.effectiveFee(w, isSubmitter),
      };
    });

    return {
      paymentId: calculated.payment_id,
      paperId: payment.paper_id,
      paperTitle: paper?.paper_title ?? '',
      submitterName: `${payment.users.first_name} ${payment.users.last_name}`,
      totalFee: calculated.total_amount != null ? Number(calculated.total_amount) : null,
      writers,
      paymentStatus: calculated.payment_status,
      sentInvoice: calculated.sent_invoice,
    };
  }

  // Update role/member_status/payment_override/manual_fee tiap writer,
  // lalu hitung ulang total SELALU server-side (JANGAN percaya total dari
  // client) — sama seperti updatePaymentAndWriters di ocs2. manual_fee
  // SEKALI diisi doang: kalau writer itu di DB udah punya manual_fee
  // non-null, request buat ngubahnya lagi DIABAIKAN (bukan error, biar FE
  // simpel — nilai lama tetap dipertahankan).
  async updateWriters(
    paymentId: string,
    writers: { writerId: string; role: string; isMember: boolean; paymentOverride: string | null; manualFee?: number | null }[],
    actorUserId?: string,
  ) {
    const payment = await this.prisma.payments.findUnique({ where: { payment_id: paymentId } });
    if (!payment || !payment.paper_id) throw new NotFoundException('Payment tidak ditemukan');

    const existing = await this.prisma.paper_writers.findMany({
      where: { writer_id: { in: writers.map((w) => w.writerId) } },
      select: { writer_id: true, manual_fee: true },
    });
    const alreadyLocked = new Set(existing.filter((e) => e.manual_fee != null).map((e) => e.writer_id));

    for (const w of writers) {
      const data: { role: string; member_status: boolean; payment_override: string | null; manual_fee?: number } = {
        role: w.role,
        member_status: w.isMember,
        payment_override: w.paymentOverride,
      };
      // Cuma tulis manual_fee kalau BELUM pernah di-set sebelumnya —
      // sekali terkunci, permintaan ubah lagi diabaikan diam-diam.
      if (w.manualFee != null && !alreadyLocked.has(w.writerId)) {
        data.manual_fee = w.manualFee;
      }
      await this.prisma.paper_writers.update({ where: { writer_id: w.writerId }, data });
    }

    const { writers: allWriters, submitterWriter } = await this.findSubmitterWriter(payment.paper_id);
    const total = this.computeTotal(allWriters, submitterWriter);
    const updated = await this.prisma.payments.update({
      where: { payment_id: paymentId },
      data: { total_amount: total, payment_status: 'waiting for payment' },
    });
    await this.auditLog.log(actorUserId, 'payment_update_writers', 'payments', paymentId, JSON.stringify(writers));
    if (total != null) {
      await this.ocs2Sync.pushPaymentTotalByPaperId(payment.paper_id, total, 'waiting for payment');
    }
    return this.paperDetail(updated.payment_id);
  }

  private async bankInfo() {
    const rows = await this.prisma.app_settings.findMany({
      where: {
        setting_key: {
          in: ['payment.bank_name', 'payment.bank_holder', 'payment.bank_account_number', 'payment.deadline_text'],
        },
      },
    });
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      bankName: map['payment.bank_name'] || '',
      bankHolder: map['payment.bank_holder'] || '',
      bankAccountNumber: map['payment.bank_account_number'] || '',
      deadlineText: map['payment.deadline_text'] || '',
    };
  }

  private async uniqueCodeFor(typeKey: 'presenter' | 'participant') {
    const row = await this.prisma.payment_types.findUnique({ where: { type_key: typeKey } });
    return row?.unique_code?.trim() || '00';
  }

  async mine(userId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { submitter_id: userId },
      include: { payments: true },
    });
    const presenterCode = await this.uniqueCodeFor('presenter');
    const teamPayments: Record<string, any>[] = [];
    for (const paper of papers) {
      for (const payment of paper.payments) {
        const calculated = await this.ensureCalculated(payment);
        const amount = calculated.total_amount != null ? Number(calculated.total_amount) : null;
        teamPayments.push({
          paymentId: calculated.payment_id,
          paperTitle: paper.paper_title,
          amount,
          transferAmount: amount != null ? applyUniqueCode(amount, presenterCode) : null,
          status: calculated.payment_status,
          description: calculated.description,
          sentInvoice: calculated.sent_invoice,
        });
      }
    }

    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    let participantPayment: Record<string, any> | null = null;
    if (participant) {
      const participantCode = await this.uniqueCodeFor('participant');
      const amount = participant.total_amount != null ? Number(participant.total_amount) : null;
      participantPayment = {
        attendanceId: participant.attendance_id,
        amount,
        transferAmount: amount != null ? applyUniqueCode(amount, participantCode) : null,
        status: participant.payment_status,
        description: participant.description,
        sentInvoice: participant.sent_invoice,
      };
    }

    return { teamPayments, participantPayment, bank: await this.bankInfo() };
  }

  async uploadProof(userId: string, paymentId: string | undefined, proofUrl: string, senderName?: string, transferDate?: string) {
    if (paymentId) {
      const payment = await this.prisma.payments.findUnique({ where: { payment_id: paymentId }, include: { papers: true } });
      if (!payment || payment.papers?.submitter_id !== userId) {
        throw new ForbiddenException('Payment ini bukan milik Anda');
      }
      await this.prisma.payment_proofs.create({
        data: { payment_id: paymentId, proof_url: proofUrl, sender_name: senderName, transfer_date: transferDate },
      });
      await this.prisma.payments.update({
        where: { payment_id: paymentId },
        data: { payment_status: 'waiting for verification' },
      });
      return { uploaded: true };
    }

    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    if (!participant) throw new NotFoundException('Data peserta tidak ditemukan');
    await this.prisma.participant.update({
      where: { attendance_id: userId },
      data: {
        link_payment_upload: proofUrl,
        payment_status: 'waiting for verification',
        payment_sender_name: senderName,
        payment_transfer_date: transferDate,
      },
    });
    return { uploaded: true };
  }

  async listByConference(conferenceId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { conference_id: conferenceId },
      include: { payments: { include: { payment_proofs: true } }, paper_writers: true },
    });
    const team: Record<string, any>[] = [];
    for (const paper of papers) {
      for (const payment of paper.payments) {
        const calculated = await this.ensureCalculated(payment);
        team.push({
          paymentId: calculated.payment_id,
          paperTitle: paper.paper_title,
          presenterNames: paper.paper_writers
            .filter((w) => w.role === 'presenter')
            .map((w) => `${w.first_name} ${w.last_name}`)
            .join(', '),
          amount: calculated.total_amount != null ? Number(calculated.total_amount) : null,
          status: calculated.payment_status,
          sentInvoice: calculated.sent_invoice,
          // Accept/Reject cuma masuk akal kalau peserta udah upload bukti
          // transfer — sebelumnya tombol ini selalu muncul walau belum
          // ada bukti sama sekali, resiko kepencet verify pembayaran yang
          // belum beneran masuk.
          hasProof: payment.payment_proofs.length > 0,
        });
      }
    }

    const participants = await this.prisma.participant.findMany({
      where: { conference_id: conferenceId },
      include: { users: true },
    });
    const participantRows = participants.map((p) => ({
      attendanceId: p.attendance_id,
      name: `${p.users.first_name} ${p.users.last_name}`,
      amount: p.total_amount != null ? Number(p.total_amount) : null,
      status: p.payment_status,
      sentInvoice: p.sent_invoice,
    }));

    return { team, participants: participantRows };
  }

  async verifyTeam(paymentId: string, action: 'accept' | 'reject', reason: string | undefined, actorUserId?: string) {
    if (action === 'reject' && !reason) throw new BadRequestException('Alasan reject wajib diisi');
    const status = action === 'accept' ? 'verified' : 'rejected';
    const description = action === 'accept' ? null : reason;
    const updated = await this.prisma.payments.update({
      where: { payment_id: paymentId },
      data: { payment_status: status, description },
    });
    await this.auditLog.log(actorUserId, `payment_${action}`, 'payments', paymentId, reason);
    // Peserta masih cek status bayar di ocs2.iapa.or.id — wajib ikut
    // ke-sync biar gak keliatan "belum diverifikasi" padahal udah.
    if (updated.paper_id) {
      await this.ocs2Sync.pushPaymentStatusByPaperId(updated.paper_id, status, description);
    }
    return updated;
  }

  async verifyParticipant(attendanceId: string, action: 'accept' | 'reject', reason: string | undefined, actorUserId?: string) {
    if (action === 'reject' && !reason) throw new BadRequestException('Alasan reject wajib diisi');
    const updated = await this.prisma.participant.update({
      where: { attendance_id: attendanceId },
      data: { payment_status: action === 'accept' ? 'verified' : 'rejected', description: action === 'accept' ? null : reason },
    });
    await this.auditLog.log(actorUserId, `payment_participant_${action}`, 'participant', attendanceId, reason);
    return updated;
  }

  async sendInvoiceTeam(paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { payment_id: paymentId },
      include: { papers: true, users: true },
    });
    if (!payment) throw new NotFoundException('Payment tidak ditemukan');
    const calculated = await this.ensureCalculated(payment);
    if (calculated.total_amount == null) throw new BadRequestException('Nominal belum bisa dihitung');

    const amount = Number(calculated.total_amount);
    const code = await this.uniqueCodeFor('presenter');
    const transferAmount = applyUniqueCode(amount, code);
    const bank = await this.bankInfo();
    const pdf = await generateInvoicePdf({
      invoiceTitle: `Invoice — ${payment.papers?.paper_title ?? ''}`,
      recipientName: `${payment.users.first_name} ${payment.users.last_name}`,
      description: 'Biaya presenter/tim untuk paper yang diterima.',
      amount,
      transferAmount,
      ...bank,
    });
    const { subject, bodyHtml } = await this.emailTemplate.render('invoice', {
      firstName: payment.users.first_name,
      description: 'untuk paper Anda',
      deadlineBlock: bank.deadlineText ? `<p><strong>Tenggat pembayaran: ${bank.deadlineText}</strong></p>` : '',
    });
    await this.mailer.sendMail(
      payment.users.email,
      subject,
      bodyHtml,
      [{ filename: `Invoice-${paymentId}.pdf`, content: pdf }],
    );
    await this.prisma.payments.update({ where: { payment_id: paymentId }, data: { sent_invoice: true } });
    if (payment.paper_id) {
      await this.ocs2Sync.pushSentInvoiceByPaperId(payment.paper_id, true);
    }
    return { sent: true };
  }

  async sendInvoiceParticipant(attendanceId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { attendance_id: attendanceId },
      include: { users: true },
    });
    if (!participant) throw new NotFoundException('Peserta tidak ditemukan');
    if (participant.total_amount == null) throw new BadRequestException('Nominal belum bisa dihitung');

    const amount = Number(participant.total_amount);
    const code = await this.uniqueCodeFor('participant');
    const transferAmount = applyUniqueCode(amount, code);
    const bank = await this.bankInfo();
    const pdf = await generateInvoicePdf({
      invoiceTitle: 'Invoice — Biaya Peserta',
      recipientName: `${participant.users.first_name} ${participant.users.last_name}`,
      description: 'Biaya partisipasi sebagai peserta conference.',
      amount,
      transferAmount,
      ...bank,
    });
    const { subject, bodyHtml } = await this.emailTemplate.render('invoice', {
      firstName: participant.users.first_name,
      description: 'partisipasi Anda',
      deadlineBlock: bank.deadlineText ? `<p><strong>Tenggat pembayaran: ${bank.deadlineText}</strong></p>` : '',
    });
    await this.mailer.sendMail(
      participant.users.email,
      subject,
      bodyHtml,
      [{ filename: `Invoice-${attendanceId}.pdf`, content: pdf }],
    );
    await this.prisma.participant.update({ where: { attendance_id: attendanceId }, data: { sent_invoice: true } });
    return { sent: true };
  }

  listPaymentTypes() {
    return this.prisma.payment_types.findMany();
  }

  async updatePaymentType(id: string, uniqueCode: string, actorUserId?: string) {
    const updated = await this.prisma.payment_types.update({
      where: { payment_type_id: id },
      data: { unique_code: uniqueCode, updated_at: new Date() },
    });
    await this.auditLog.log(actorUserId, 'update_payment_type', 'payment_types', id, uniqueCode);
    return updated;
  }
}
