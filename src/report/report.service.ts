import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { signedDocumentUrl } from '../papers/papers.service';
import { signedTeamProofUrl, signedParticipantProofUrl } from '../payment/payment.service';

function formatRupiah(n: bigint | number | null | undefined): string {
  if (n == null) return '';
  return Number(n).toLocaleString('id-ID');
}

// Service ini CUMA ngambil data & bentuk jadi baris object (keyed by
// kolom key di report-columns.constant.ts) — nggak lagi langsung bentuk
// CSV string di sini. Filtering kolom + format file (CSV/XLSX) ditangani
// di controller lewat report-file.util.ts, biar satu sumber data bisa
// dipakai buat kedua format tanpa duplikasi query.
@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getPapersRows(conferenceId?: string): Promise<Record<string, unknown>[]> {
    const papers = await this.prisma.papers.findMany({
      where: conferenceId ? { conference_id: conferenceId } : {},
      select: {
        paper_id: true,
        paper_title: true,
        paper_status: true,
        conference_status: true,
        type: true,
        sub_theme: true,
        keywords: true,
        abstract_text: true,
        sent_loa: true,
        document_url: true,
        conference_id: true,
        conference_papers_conference_idToconference: {
          select: { conference_name: true },
        },
        users: {
          select: { first_name: true, last_name: true, email: true },
        },
        paper_writers: {
          select: {
            role: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
        payments: {
          select: {
            payment_id: true,
            payment_status: true,
            total_amount: true,
          },
        },
      },
      orderBy: { paper_id: 'asc' },
    });

    return papers.map((p) => {
      // Nama/email penulis disimpan LANGSUNG di kolom paper_writers sendiri
      // (bukan via relasi .users — itu FK opsional yang hampir selalu null,
      // writer biasanya nggak punya akun users terkait).
      const writers = p.paper_writers.map((pw) => `${pw.first_name} ${pw.last_name}`.trim());
      const writerEmails = p.paper_writers.map((pw) => pw.email);
      const payment = p.payments?.[0];
      return {
        paperId: p.paper_id,
        paperTitle: p.paper_title,
        conference: p.conference_papers_conference_idToconference?.conference_name ?? '',
        paperStatus: p.paper_status,
        conferenceStatus: p.conference_status ?? '',
        type: p.type ?? '',
        subTheme: p.sub_theme ?? '',
        keywords: p.keywords ?? '',
        submitterName: `${p.users?.first_name ?? ''} ${p.users?.last_name ?? ''}`.trim(),
        submitterEmail: p.users?.email ?? '',
        writers: writers.join('; '),
        writerEmails: writerEmails.join('; '),
        paymentStatus: payment?.payment_status ?? '',
        totalPayment: payment?.total_amount != null ? formatRupiah(payment.total_amount as any) : '',
        sentLoa: p.sent_loa ? 'Ya' : 'Tidak',
        documentUrl: p.document_url ? signedDocumentUrl(p.paper_id) : '',
      };
    });
  }

  async getPaymentsRows(conferenceId?: string): Promise<Record<string, unknown>[]> {
    const payments = await this.prisma.payments.findMany({
      where: conferenceId ? { papers: { conference_id: conferenceId } } : {},
      select: {
        payment_id: true,
        payment_status: true,
        total_amount: true,
        due_date: true,
        sent_invoice: true,
        payment_type: true,
        description: true,
        papers: {
          select: {
            paper_id: true,
            paper_title: true,
            conference_id: true,
            conference_papers_conference_idToconference: {
              select: { conference_name: true },
            },
          },
        },
        users: {
          select: { first_name: true, last_name: true, email: true },
        },
        invoices: {
          select: {
            nominal: true,
            paper_writers: {
              select: { first_name: true, last_name: true, email: true, member_status: true },
            },
          },
        },
        payment_proofs: {
          select: { proof_id: true },
          take: 1,
        },
      },
      orderBy: { payment_id: 'asc' },
    });

    const rows: Record<string, unknown>[] = [];
    for (const pay of payments) {
      const conference = pay.papers?.conference_papers_conference_idToconference?.conference_name ?? '';
      const base = {
        paymentId: pay.payment_id,
        conference,
        paperId: pay.papers?.paper_id ?? '',
        paperTitle: pay.papers?.paper_title ?? pay.description ?? '',
        submitterName: `${pay.users?.first_name ?? ''} ${pay.users?.last_name ?? ''}`.trim(),
        submitterEmail: pay.users?.email ?? '',
        paymentStatus: pay.payment_status ?? '',
        totalAmount: pay.total_amount != null ? formatRupiah(pay.total_amount as any) : '',
        dueDate: pay.due_date ? new Date(pay.due_date).toLocaleDateString('id-ID') : '',
        sentInvoice: pay.sent_invoice ? 'Ya' : 'Tidak',
        proofUrl: pay.payment_proofs.length > 0 ? signedTeamProofUrl(pay.payment_id) : '',
      };

      const invoiceLines = pay.invoices ?? [];
      if (invoiceLines.length === 0) {
        rows.push({ ...base, writerName: '', writerEmail: '', writerFee: '', isMember: '' });
      } else {
        for (const inv of invoiceLines) {
          rows.push({
            ...base,
            writerName: `${inv.paper_writers.first_name} ${inv.paper_writers.last_name}`.trim(),
            writerEmail: inv.paper_writers.email,
            // nominal disimpan sebagai string di tabel invoices (bukan Decimal) —
            // format manual aja, nggak lewat formatRupiah yang nunggu number/bigint.
            writerFee: Number.isNaN(Number(inv.nominal)) ? inv.nominal : `Rp${Number(inv.nominal).toLocaleString('id-ID')}`,
            isMember: inv.paper_writers.member_status ? 'Member' : 'Non-Member',
          });
        }
      }
    }
    return rows;
  }

  async getParticipantsRows(conferenceId?: string): Promise<Record<string, unknown>[]> {
    const participants = await this.prisma.participant.findMany({
      where: conferenceId ? { conference_id: conferenceId } : {},
      select: {
        attendance_id: true,
        payment_status: true,
        total_amount: true,
        is_member: true,
        role: true,
        sent_invoice: true,
        link_payment_upload: true,
        conference_id: true,
        conference: {
          select: { conference_name: true },
        },
        users: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
      orderBy: { attendance_id: 'asc' },
    });

    return participants.map((p) => ({
      attendanceId: p.attendance_id,
      name: `${p.users?.first_name ?? ''} ${p.users?.last_name ?? ''}`.trim(),
      email: p.users?.email ?? '',
      conference: p.conference?.conference_name ?? '',
      role: p.role ?? '',
      isMember: p.is_member ? 'Member' : 'Non-Member',
      paymentStatus: p.payment_status ?? '',
      totalAmount: p.total_amount != null ? formatRupiah(p.total_amount) : '',
      sentInvoice: p.sent_invoice ? 'Ya' : 'Tidak',
      proofUrl: p.link_payment_upload ? signedParticipantProofUrl(p.attendance_id) : '',
    }));
  }
}
