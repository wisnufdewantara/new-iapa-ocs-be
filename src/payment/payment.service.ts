import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { AuditLogService } from '../common/audit-log.service';
import { presenterFee } from './pricing.constant';
import { applyUniqueCode } from './unique-code.util';
import { generateInvoicePdf } from './invoice-pdf.util';

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private auditLog: AuditLogService,
  ) {}

  // payments.total_amount NULL = trigger DB baru bikin baris placeholder
  // (paper baru di-accept), belum dihitung. Niru resolveTotalAmount di
  // legacy: hitung dari fee tiap presenter di paper ini, simpan sekali.
  private async ensureCalculated(payment: any) {
    if (payment.total_amount != null || !payment.paper_id) return payment;
    const writers = await this.prisma.paper_writers.findMany({
      where: { paper_id: payment.paper_id, role: 'presenter' },
    });
    const total = writers.reduce((sum, w) => sum + presenterFee(w.member_status), 0);
    return this.prisma.payments.update({
      where: { payment_id: payment.payment_id },
      data: { total_amount: total, payment_status: 'waiting for payment' },
    });
  }

  private async bankInfo() {
    const rows = await this.prisma.app_settings.findMany({
      where: { setting_key: { in: ['payment.bank_name', 'payment.bank_holder', 'payment.bank_account_number'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      bankName: map['payment.bank_name'] || '',
      bankHolder: map['payment.bank_holder'] || '',
      bankAccountNumber: map['payment.bank_account_number'] || '',
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
      include: { payments: true, paper_writers: true },
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
    const updated = await this.prisma.payments.update({
      where: { payment_id: paymentId },
      data: { payment_status: action === 'accept' ? 'verified' : 'rejected', description: action === 'accept' ? null : reason },
    });
    await this.auditLog.log(actorUserId, `payment_${action}`, 'payments', paymentId, reason);
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
    await this.mailer.sendMail(
      payment.users.email,
      'Invoice Pembayaran — IAPA Conference',
      `<p>Dear ${payment.users.first_name},</p><p>Terlampir invoice pembayaran untuk paper Anda.</p>`,
      [{ filename: `Invoice-${paymentId}.pdf`, content: pdf }],
    );
    await this.prisma.payments.update({ where: { payment_id: paymentId }, data: { sent_invoice: true } });
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
    await this.mailer.sendMail(
      participant.users.email,
      'Invoice Pembayaran — IAPA Conference',
      `<p>Dear ${participant.users.first_name},</p><p>Terlampir invoice pembayaran partisipasi Anda.</p>`,
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
