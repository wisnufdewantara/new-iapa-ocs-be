import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { AuditLogService } from '../common/audit-log.service';
import { EmailTemplateService } from '../email-template/email-template.service';
import { presenterFee } from './pricing.constant';
import { applyUniqueCode } from './unique-code.util';
import { generateInvoicePdf } from './invoice-pdf.util';
import { generateReceiptPdf } from './receipt-pdf.util';
import { Ocs2SyncService } from './ocs2-sync.service';
import { StoredFileLocation, resolveStoredFile } from '../common/upload-path.util';
import { signFileToken } from '../common/file-access-token.util';

export function contentTypeForPath(path: string): string {
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

// Bukti transfer sebelumnya diserve lewat static file PUBLIK — lihat
// penjelasan lengkap di common/file-access-token.util.ts. Link yang
// dikasih ke frontend sekarang capability URL, bukan path mentah; akses
// dicek SEKALI di sini (method ini cuma dipanggil dari endpoint yang
// sudah di-guard payment:verify), endpoint yang nge-serve filenya sendiri
// cuma validasi token.
// Absolute, BUKAN relatif — sama alasannya kayak signedDocumentUrl di
// papers.service.ts: link ini harus bisa diklik langsung dari file
// Excel/CSV yang didownload, bukan cuma dari dalam app sendiri.
function fileLinkBase(): string {
  return (process.env.FRONTEND_URL || 'https://dev-ocs.iapa.or.id').replace(/\/$/, '');
}

export function signedTeamProofUrl(paymentId: string): string {
  return `${fileLinkBase()}/api/payment/${paymentId}/proof?token=${signFileToken('team-proof', paymentId)}`;
}

export function signedTeamProofUrlByProofId(proofId: string): string {
  return `${fileLinkBase()}/api/payment/proof/${proofId}?token=${signFileToken('team-proof-by-id', proofId)}`;
}

export function signedParticipantProofUrl(attendanceId: string): string {
  return `${fileLinkBase()}/api/payment/participant/${attendanceId}/proof?token=${signFileToken('participant-proof', attendanceId)}`;
}

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

  // Bukti transfer sebelumnya cuma diserve lewat static file publik
  // (/api/uploads/payment-proofs/..., nggak ada auth) — dipakai endpoint
  // terautentikasi (gated payment:verify lewat controller) buat GANTI
  // itu. Payment bisa punya banyak proof (re-upload) — ambil yang
  // terbaru, sama kayak yang ditampilkan paling atas di halaman detail.
  async getTeamProofDiskPath(paymentId: string): Promise<StoredFileLocation> {
    const proof = await this.prisma.payment_proofs.findFirst({
      where: { payment_id: paymentId },
      orderBy: { upload_date: 'desc' },
      select: { proof_url: true },
    });
    if (!proof) throw new NotFoundException('Belum ada bukti transfer untuk payment ini');
    return resolveStoredFile(proof.proof_url);
  }

  // Varian by-proofId — dipakai halaman detail pembayaran yang nampilin
  // SEMUA proof satu payment (bisa lebih dari 1 kalau re-upload), beda
  // dari getTeamProofDiskPath() di atas yang cuma ngasih proof TERBARU
  // (dipakai link di laporan, yang cukup 1 link per baris payment).
  async getTeamProofDiskPathByProofId(proofId: string): Promise<StoredFileLocation> {
    const proof = await this.prisma.payment_proofs.findUnique({
      where: { proof_id: proofId },
      select: { proof_url: true },
    });
    if (!proof) throw new NotFoundException('Bukti transfer tidak ditemukan');
    return resolveStoredFile(proof.proof_url);
  }

  async getParticipantProofDiskPath(attendanceId: string): Promise<StoredFileLocation> {
    const participant = await this.prisma.participant.findUnique({
      where: { attendance_id: attendanceId },
      select: { link_payment_upload: true },
    });
    if (!participant?.link_payment_upload) throw new NotFoundException('Belum ada bukti transfer untuk peserta ini');
    return resolveStoredFile(participant.link_payment_upload);
  }

  // Detail per-paper: breakdown tiap writer & fee masing-masing, buat
  // halaman edit admin (mirip PaymentDetails.vue di ocs2).
  async paperDetail(paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { payment_id: paymentId },
      include: {
        papers: { include: { paper_writers: { orderBy: { writer_order: 'asc' } } } },
        users: true,
        payment_proofs: { orderBy: { upload_date: 'desc' } },
      },
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
        firstName: w.first_name,
        lastName: w.last_name,
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
      // Bukti transfer yang di-upload peserta — sebelumnya kesimpen tapi
      // nggak pernah ke-return ke FE sama sekali, jadi admin nggak punya
      // cara liat filenya walau tombol Accept/Reject udah nge-cek hasProof.
      proofs: payment.payment_proofs.map((p) => ({
        proofId: p.proof_id,
        proofUrl: signedTeamProofUrlByProofId(p.proof_id),
        senderName: p.sender_name,
        transferDate: p.transfer_date,
        uploadDate: p.upload_date,
      })),
    };
  }

  // "Edit Penulis" — update role/nama/member_status/payment_override/
  // manual_fee tiap writer yang udah ada, TAMBAH writer baru, dan HAPUS
  // writer, lalu hitung ulang total SELALU server-side (JANGAN percaya
  // total dari client) — sama seperti updatePaymentAndWriters di ocs2.
  // manual_fee SEKALI diisi doang: kalau writer itu di DB udah punya
  // manual_fee non-null, request buat ngubahnya lagi DIABAIKAN (bukan
  // error, biar FE simpel — nilai lama tetap dipertahankan).
  async updateWriters(
    paymentId: string,
    writers: {
      writerId: string;
      firstName?: string;
      lastName?: string;
      role: string;
      isMember: boolean;
      paymentOverride: string | null;
      manualFee?: number | null;
    }[],
    actorUserId?: string,
    newWriters?: {
      firstName: string;
      lastName?: string;
      gender: string;
      affiliation: string;
      email: string;
      phoneNumber?: string;
      role: string;
      isMember: boolean;
    }[],
    deleteWriterIds?: string[],
  ) {
    const payment = await this.prisma.payments.findUnique({ where: { payment_id: paymentId } });
    if (!payment || !payment.paper_id) throw new NotFoundException('Payment tidak ditemukan');
    const paperId = payment.paper_id;

    const remainingCount = writers.length + (newWriters?.length ?? 0);
    if (remainingCount === 0) {
      throw new BadRequestException('Paper harus punya minimal 1 penulis');
    }

    // Hapus dulu — jaga-jaga writer_id nyasar dari paper lain, cuma
    // proses yang beneran nempel ke paper ini.
    if (deleteWriterIds?.length) {
      const toDelete = await this.prisma.paper_writers.findMany({
        where: { writer_id: { in: deleteWriterIds }, paper_id: paperId },
        select: { writer_id: true },
      });
      for (const d of toDelete) {
        await this.prisma.paper_writers.delete({ where: { writer_id: d.writer_id } });
        await this.ocs2Sync.pushWriterDelete(d.writer_id);
      }
      await this.auditLog.log(actorUserId, 'payment_delete_writers', 'payments', paymentId, JSON.stringify(deleteWriterIds));
    }

    // Discolosed IDOR fix: scope ke paper_id SAMA kayak branch delete di
    // atas — tanpa ini, writer_id dari paper LAIN yang kebetulan diketahui
    // (mis. lewat GET detail paper lain) bisa ikut ke-update lewat request
    // yang nominalnya buat paymentId ini.
    const existing = await this.prisma.paper_writers.findMany({
      where: { writer_id: { in: writers.map((w) => w.writerId) }, paper_id: paperId },
      select: { writer_id: true, manual_fee: true },
    });
    const validWriterIds = new Set(existing.map((e) => e.writer_id));
    const alreadyLocked = new Set(existing.filter((e) => e.manual_fee != null).map((e) => e.writer_id));

    for (const w of writers) {
      if (!validWriterIds.has(w.writerId)) {
        throw new ForbiddenException(`Writer ${w.writerId} bukan bagian dari paper ini`);
      }
      const data: {
        role: string;
        member_status: boolean;
        payment_override: string | null;
        manual_fee?: number;
        first_name?: string;
        last_name?: string;
      } = {
        role: w.role,
        member_status: w.isMember,
        payment_override: w.paymentOverride,
      };
      if (w.firstName !== undefined) data.first_name = w.firstName;
      if (w.lastName !== undefined) data.last_name = w.lastName;
      // Cuma tulis manual_fee kalau BELUM pernah di-set sebelumnya —
      // sekali terkunci, permintaan ubah lagi diabaikan diam-diam.
      if (w.manualFee != null && !alreadyLocked.has(w.writerId)) {
        data.manual_fee = w.manualFee;
      }
      await this.prisma.paper_writers.update({ where: { writer_id: w.writerId }, data });
    }

    // Penulis baru — writer_order lanjut dari yang paling besar biar
    // nongol di urutan paling akhir.
    if (newWriters?.length) {
      const maxOrderRow = await this.prisma.paper_writers.findFirst({
        where: { paper_id: paperId },
        orderBy: { writer_order: 'desc' },
        select: { writer_order: true },
      });
      let nextOrder = (maxOrderRow?.writer_order ?? -1) + 1;
      for (const nw of newWriters) {
        const writerId = randomUUID();
        await this.prisma.paper_writers.create({
          data: {
            writer_id: writerId,
            paper_id: paperId,
            first_name: nw.firstName,
            last_name: nw.lastName ?? '',
            gender: nw.gender,
            affiliation: nw.affiliation,
            email: nw.email,
            phone_number: nw.phoneNumber,
            role: nw.role,
            member_status: nw.isMember,
            writer_order: nextOrder++,
          },
        });
        await this.ocs2Sync.pushWriterCreate({
          writerId,
          paperId,
          firstName: nw.firstName,
          lastName: nw.lastName ?? '',
          gender: nw.gender,
          affiliation: nw.affiliation,
          email: nw.email,
          phoneNumber: nw.phoneNumber,
          role: nw.role,
          isMember: nw.isMember,
        });
      }
      await this.auditLog.log(actorUserId, 'payment_add_writers', 'payments', paymentId, JSON.stringify(newWriters));
    }

    const { writers: allWriters, submitterWriter } = await this.findSubmitterWriter(paperId);
    const total = this.computeTotal(allWriters, submitterWriter);
    const updated = await this.prisma.payments.update({
      where: { payment_id: paymentId },
      data: { total_amount: total, payment_status: 'waiting for payment' },
    });
    await this.auditLog.log(actorUserId, 'payment_update_writers', 'payments', paymentId, JSON.stringify(writers));
    if (total != null) {
      await this.ocs2Sync.pushPaymentTotalByPaperId(paperId, total, 'waiting for payment');
    }
    // Push member_status + nama per writer juga — bukan cuma total-nya.
    // Gap ini yang bikin ocs2 kadang nunjukkin data basi meski total-nya
    // udah match (lihat komentar di Ocs2SyncService).
    for (const w of writers) {
      const fields: Record<string, unknown> = { member_status: w.isMember };
      if (w.firstName !== undefined) fields.first_name = w.firstName;
      if (w.lastName !== undefined) fields.last_name = w.lastName;
      await this.ocs2Sync.pushWriterFields(w.writerId, fields);
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
      // Arah kebalikan dari ProofPullSyncService (yang ocs2 -> newocs) —
      // ini buat kasus peserta upload bukti LANGSUNG lewat newocs, biar
      // ocs2 juga ikut tau statusnya udah "waiting for verification".
      if (payment.paper_id) {
        await this.ocs2Sync.pushPaymentStatusByPaperId(payment.paper_id, 'waiting for verification');
      }
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

  // Admin upload bukti transfer ATAS NAMA presenter/peserta (mis. bukti
  // dikirim lewat WA/email, bukan diupload sendiri). Beda dari uploadProof()
  // di atas: nggak ada cek kepemilikan (dijaga payment:verify di controller),
  // dan status yang udah "verified" nggak diturunin balik — admin bisa aja
  // cuma nambahin arsip bukti buat pembayaran yang udah diverifikasi.
  async adminUploadTeamProof(
    paymentId: string,
    proofUrl: string,
    senderName: string | undefined,
    transferDate: string | undefined,
    actorUserId?: string,
  ) {
    const payment = await this.prisma.payments.findUnique({ where: { payment_id: paymentId } });
    if (!payment) throw new NotFoundException('Payment tidak ditemukan');
    await this.prisma.payment_proofs.create({
      data: { payment_id: paymentId, proof_url: proofUrl, sender_name: senderName, transfer_date: transferDate },
    });
    if (payment.payment_status !== 'verified') {
      await this.prisma.payments.update({
        where: { payment_id: paymentId },
        data: { payment_status: 'waiting for verification' },
      });
      if (payment.paper_id) {
        await this.ocs2Sync.pushPaymentStatusByPaperId(payment.paper_id, 'waiting for verification');
      }
    }
    await this.auditLog.log(actorUserId, 'payment_admin_upload_proof', 'payments', paymentId);
    return { uploaded: true };
  }

  async adminUploadParticipantProof(
    attendanceId: string,
    proofUrl: string,
    senderName: string | undefined,
    transferDate: string | undefined,
    actorUserId?: string,
  ) {
    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: attendanceId } });
    if (!participant) throw new NotFoundException('Peserta tidak ditemukan');
    await this.prisma.participant.update({
      where: { attendance_id: attendanceId },
      data: {
        link_payment_upload: proofUrl,
        payment_sender_name: senderName,
        payment_transfer_date: transferDate,
        ...(participant.payment_status !== 'verified' ? { payment_status: 'waiting for verification' } : {}),
      },
    });
    await this.auditLog.log(actorUserId, 'payment_participant_admin_upload_proof', 'participant', attendanceId);
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
    // Race-condition fix: updateMany dengan where payment_status != target
    // atomic di level DB — double-click/retry jaringan yang bikin 2
    // request 'accept' nyaris bersamaan cuma SATU yang lolos (count>0),
    // yang kedua ketahuan lewat count===0 dan DITOLAK sebelum sempat
    // ngirim kwitansi duplikat. Transisi sebaliknya (verified->reject buat
    // koreksi kesalahan) tetap diizinkan — yang diblokir cuma re-trigger
    // aksi yang SAMA ke status yang SAMA.
    const { count } = await this.prisma.payments.updateMany({
      where: { payment_id: paymentId, payment_status: { not: status } },
      data: { payment_status: status, description },
    });
    if (count === 0) {
      throw new BadRequestException(
        action === 'accept' ? 'Pembayaran ini sudah diverifikasi.' : 'Pembayaran ini sudah ditolak.',
      );
    }
    const updated = await this.prisma.payments.findUniqueOrThrow({ where: { payment_id: paymentId } });
    await this.auditLog.log(actorUserId, `payment_${action}`, 'payments', paymentId, reason);
    // Peserta masih cek status bayar di ocs2.iapa.or.id — wajib ikut
    // ke-sync biar gak keliatan "belum diverifikasi" padahal udah.
    if (updated.paper_id) {
      await this.ocs2Sync.pushPaymentStatusByPaperId(updated.paper_id, status, description);
    }

    if (action === 'accept') {
      try {
        await this.sendReceiptTeam(paymentId);
      } catch (err) {
        console.error('Failed to auto-send receipt for team payment:', err);
      }
    }

    return updated;
  }

  async verifyParticipant(attendanceId: string, action: 'accept' | 'reject', reason: string | undefined, actorUserId?: string) {
    if (action === 'reject' && !reason) throw new BadRequestException('Alasan reject wajib diisi');
    const status = action === 'accept' ? 'verified' : 'rejected';
    // Race-condition fix — sama kayak verifyTeam() di atas.
    const { count } = await this.prisma.participant.updateMany({
      where: { attendance_id: attendanceId, payment_status: { not: status } },
      data: { payment_status: status, description: action === 'accept' ? null : reason },
    });
    if (count === 0) {
      throw new BadRequestException(
        action === 'accept' ? 'Pembayaran ini sudah diverifikasi.' : 'Pembayaran ini sudah ditolak.',
      );
    }
    const updated = await this.prisma.participant.findUniqueOrThrow({ where: { attendance_id: attendanceId } });
    await this.auditLog.log(actorUserId, `payment_participant_${action}`, 'participant', attendanceId, reason);

    if (action === 'accept') {
      try {
        await this.sendReceiptParticipant(attendanceId);
      } catch (err) {
        console.error('Failed to auto-send receipt for participant payment:', err);
      }
    }

    // Pre-existing bug (bukan dari fix hari ini) — participant.total_amount
    // itu BigInt di schema, dikembalikan mentah ke Express bikin crash
    // "Do not know how to serialize a BigInt" SETELAH update ke DB-nya
    // sendiri sukses. Akibatnya admin lihat error di browser padahal
    // verify/reject-nya beneran kepencet & kesimpen — ketahuan dari log
    // produksi (stderr.log, 2026-10-06 sore).
    return { ...updated, total_amount: updated.total_amount != null ? Number(updated.total_amount) : null };
  }

  // Detail peserta buat admin — mirror paperDetail() tapi jauh lebih
  // simpel: participant cuma 1 baris per orang (bukan tim banyak writer),
  // jadi nggak ada breakdown fee per-writer, cuma 1 nominal.
  async participantDetail(attendanceId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { attendance_id: attendanceId },
      include: { users: true, conference: true },
    });
    if (!participant) throw new NotFoundException('Peserta tidak ditemukan');

    return {
      attendanceId: participant.attendance_id,
      name: `${participant.users.first_name} ${participant.users.last_name}`,
      email: participant.users.email,
      conferenceName: participant.conference?.conference_name ?? '',
      isMember: participant.is_member,
      totalAmount: participant.total_amount != null ? Number(participant.total_amount) : null,
      paymentStatus: participant.payment_status,
      sentInvoice: participant.sent_invoice,
      proofUrl: participant.link_payment_upload ? signedParticipantProofUrl(participant.attendance_id) : null,
      senderName: participant.payment_sender_name,
      transferDate: participant.payment_transfer_date,
    };
  }

  // Override manual nominal+membership peserta — sebelumnya total_amount
  // cuma keisi sekali lewat trigger DB pas join (lihat ParticipantService),
  // admin nggak punya cara ubah lagi kalau salah/mau dikecualikan dari
  // aturan member/non-member standar. Beda dari manual_fee writer (sekali
  // kunci gak bisa diubah lagi) — di sini boleh direvisi berkali-kali
  // karena cuma 1 orang per baris, bukan daftar banyak penulis yang
  // riskan konflik kalau gampang diubah-ubah.
  async overrideParticipant(attendanceId: string, isMember: boolean, totalAmount: number, actorUserId?: string) {
    const existing = await this.prisma.participant.findUnique({ where: { attendance_id: attendanceId } });
    if (!existing) throw new NotFoundException('Peserta tidak ditemukan');

    // Financial-integrity fix: nominal yang sudah "verified" (sudah
    // dikirim kwitansi resmi ke peserta) jangan bisa diubah diam-diam —
    // itu bikin kwitansi yang udah dikirim beda dari nominal yang
    // tersimpan sekarang, nggak ada jejak nominal asli yang pernah
    // diverifikasi. Admin harus reject dulu (lewat verify endpoint) buat
    // "buka kunci"-nya, baru override, baru verify ulang (otomatis kirim
    // kwitansi baru dengan nominal yang benar) — jejaknya kelihatan di
    // audit log sebagai 2 aksi terpisah, bukan 1 override senyap.
    if (existing.payment_status === 'verified') {
      throw new BadRequestException(
        'Pembayaran ini sudah verified. Reject dulu lewat tombol verifikasi sebelum override nominal, baru verify ulang setelah override.',
      );
    }

    const updated = await this.prisma.participant.update({
      where: { attendance_id: attendanceId },
      data: { is_member: isMember, total_amount: BigInt(Math.round(totalAmount)) },
    });
    await this.auditLog.log(
      actorUserId,
      'payment_participant_override',
      'participant',
      attendanceId,
      `isMember=${isMember}, totalAmount=${totalAmount}`,
    );
    return { ...updated, total_amount: Number(updated.total_amount) };
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
    // Nominal yang dicetak di PDF = nominal transfer sesungguhnya (udah
    // termasuk kode unik) — niru persis legacy, bendahara mencocokkan
    // invoice ke mutasi rekening manual.
    const pdf = await generateInvoicePdf({ amount: transferAmount });
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
      { type: 'invoice', relatedId: paymentId },
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
    const pdf = await generateInvoicePdf({ amount: transferAmount });
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
      { type: 'invoice', relatedId: attendanceId },
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

  // Download invoice PDF (admin) setelah pembayaran diverifikasi atau
  // invoice udah pernah dikirim. Reuse generateInvoicePdf() (sama persis
  // dipakai sendInvoiceTeam) — JANGAN re-implement generate PDF-nya di sini
  // lagi, dan JANGAN lupa applyUniqueCode kayak di semua alur invoice lain,
  // biar nominal yang didownload admin match persis sama yang diinvoice ke
  // presenter (penting buat rekonsiliasi mutasi rekening).
  async downloadInvoice(paymentId: string, res: any) {
    const payment = await this.prisma.payments.findUnique({ where: { payment_id: paymentId } });
    if (!payment) throw new NotFoundException('Payment tidak ditemukan');

    if (payment.payment_status !== 'verified' && !payment.sent_invoice) {
      throw new BadRequestException('Invoice tidak bisa didownload: pembayaran belum diverifikasi atau invoice belum pernah dikirim');
    }

    const amount = payment.total_amount != null ? Number(payment.total_amount) : 0;
    const code = await this.uniqueCodeFor('presenter');
    const transferAmount = applyUniqueCode(amount, code);
    const pdfBuffer = await generateInvoicePdf({ amount: transferAmount });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-${paymentId}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  // Self-service: download invoice sendiri (team presenter atau participant)
  // Tersedia setelah sent_invoice = true atau payment_status = 'verified'
  async downloadMyInvoice(userId: string, res: any) {
    // Cari payment tim (jika presenter) dulu
    const paper = await this.prisma.papers.findFirst({
      where: { submitter_id: userId },
      include: { payments: true },
      orderBy: { upload_date: 'desc' },
    });
    if (paper && paper.payments.length > 0) {
      const payment = paper.payments[0];
      if (!payment.sent_invoice && payment.payment_status !== 'verified') {
        throw new BadRequestException('Invoice belum tersedia. Tunggu konfirmasi dari admin.');
      }
      const amount = payment.total_amount != null ? Number(payment.total_amount) : 0;
      const code = await this.uniqueCodeFor('presenter');
      const transferAmount = applyUniqueCode(amount, code);
      const pdfBuffer = await generateInvoicePdf({ amount: transferAmount });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-presenter.pdf"`,
        'Content-Length': pdfBuffer.length,
      });
      return res.send(pdfBuffer);
    }

    // Fallback ke participant biasa
    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    if (!participant) throw new NotFoundException('Data pembayaran tidak ditemukan.');
    if (!participant.sent_invoice && participant.payment_status !== 'verified') {
      throw new BadRequestException('Invoice belum tersedia. Tunggu konfirmasi dari admin.');
    }
    const amount = participant.total_amount != null ? Number(participant.total_amount) : 0;
    const code = await this.uniqueCodeFor('participant');
    const transferAmount = applyUniqueCode(amount, code);
    const pdfBuffer = await generateInvoicePdf({ amount: transferAmount });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-peserta.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  // Self-service: download kuitansi pembayaran (hanya setelah status 'verified')
  async downloadMyReceipt(userId: string, res: any) {
    const user = await this.prisma.users.findUnique({ where: { user_id: userId }, select: { first_name: true, last_name: true } });
    const userName = user ? `${user.first_name} ${user.last_name}` : 'Participant';

    const paper = await this.prisma.papers.findFirst({
      where: { submitter_id: userId },
      include: { payments: true },
      orderBy: { upload_date: 'desc' },
    });
    if (paper && paper.payments.length > 0) {
      const payment = paper.payments[0];
      if (payment.payment_status !== 'verified') {
        throw new BadRequestException('Kuitansi hanya tersedia setelah pembayaran diverifikasi.');
      }
      const amount = payment.total_amount != null ? Number(payment.total_amount) : 0;
      const pdfBuffer = await generateReceiptPdf({
        recipientName: userName,
        amount,
        description: `Presenter fee — ${paper.paper_title}`,
        receiptNumber: `RCP-${payment.payment_id.substring(0, 8).toUpperCase()}`,
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Kuitansi-presenter.pdf"`,
        'Content-Length': pdfBuffer.length,
      });
      return res.send(pdfBuffer);
    }

    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    if (!participant) throw new NotFoundException('Data pembayaran tidak ditemukan.');
    if (participant.payment_status !== 'verified') {
      throw new BadRequestException('Kuitansi hanya tersedia setelah pembayaran diverifikasi.');
    }
    const amount = participant.total_amount != null ? Number(participant.total_amount) : 0;
    const pdfBuffer = await generateReceiptPdf({
      recipientName: userName,
      amount,
      description: 'Conference participation fee',
      receiptNumber: `RCP-${participant.attendance_id.substring(0, 8).toUpperCase()}`,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Kuitansi-peserta.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  // Admin: kirim kuitansi ke peserta team (setelah verified)
  async sendReceiptTeam(paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { payment_id: paymentId },
      include: { papers: true, users: true },
    });
    if (!payment) throw new NotFoundException('Payment tidak ditemukan');
    if (payment.payment_status !== 'verified') {
      throw new BadRequestException('Kuitansi hanya bisa dikirim setelah pembayaran diverifikasi.');
    }
    const amount = payment.total_amount != null ? Number(payment.total_amount) : 0;
    const userName = `${payment.users.first_name} ${payment.users.last_name}`;
    const pdfBuffer = await generateReceiptPdf({
      recipientName: userName,
      amount,
      description: `Presenter fee — ${payment.papers?.paper_title ?? ''}`,
      receiptNumber: `RCP-${payment.payment_id.substring(0, 8).toUpperCase()}`,
    });
    const { subject, bodyHtml } = await this.emailTemplate.render('receipt', {
      firstName: payment.users.first_name,
      description: `untuk paper "${payment.papers?.paper_title ?? ''}"`,
    });
    await this.mailer.sendMail(
      payment.users.email,
      subject,
      bodyHtml,
      [{ filename: `Kwitansi-${paymentId}.pdf`, content: pdfBuffer }],
      { type: 'receipt', relatedId: paymentId },
    );
    return { sent: true };
  }

  // Admin: kirim kuitansi ke participant biasa (setelah verified)
  async sendReceiptParticipant(attendanceId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { attendance_id: attendanceId },
      include: { users: true },
    });
    if (!participant) throw new NotFoundException('Peserta tidak ditemukan');
    if (participant.payment_status !== 'verified') {
      throw new BadRequestException('Kuitansi hanya bisa dikirim setelah pembayaran diverifikasi.');
    }
    const amount = participant.total_amount != null ? Number(participant.total_amount) : 0;
    const userName = `${participant.users.first_name} ${participant.users.last_name}`;
    const pdfBuffer = await generateReceiptPdf({
      recipientName: userName,
      amount,
      description: 'Conference participation fee',
      receiptNumber: `RCP-${attendanceId.substring(0, 8).toUpperCase()}`,
    });
    const { subject, bodyHtml } = await this.emailTemplate.render('receipt', {
      firstName: participant.users.first_name,
      description: 'partisipasi Anda sebagai peserta conference',
    });
    await this.mailer.sendMail(
      participant.users.email,
      subject,
      bodyHtml,
      [{ filename: `Kwitansi-${attendanceId}.pdf`, content: pdfBuffer }],
      { type: 'receipt', relatedId: attendanceId },
    );
    return { sent: true };
  }
}
