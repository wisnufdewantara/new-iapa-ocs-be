import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Escape a CSV cell: wrap in quotes & escape internal quotes, dan netralkan
 * CSV/formula injection (CWE-1236) — paper_title/keywords/nama penulis dkk
 * itu free-text yang diisi presenter (untrusted), tapi file CSV-nya dibuka
 * admin di Excel/Sheets. Cell yang diawali =/+/-/@/tab/CR ditafsirkan Excel
 * sebagai formula (mis. =HYPERLINK(...) buat phishing/exfiltrasi data), jadi
 * diprefix tanda kutip tunggal biar dipaksa jadi teks biasa.
 */
function csvCell(val: unknown): string {
  if (val == null) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes and wrap if necessary
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function formatRupiah(n: bigint | number | null | undefined): string {
  if (n == null) return '';
  return Number(n).toLocaleString('id-ID');
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportPapersCsv(conferenceId?: string): Promise<string> {
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

    const headers = [
      'Paper ID',
      'Judul Paper',
      'Conference',
      'Status Paper',
      'Status Conference',
      'Tipe',
      'Sub Tema',
      'Keywords',
      'Submitter',
      'Email Submitter',
      'Penulis (semua)',
      'Email Penulis',
      'Status Pembayaran',
      'Total Pembayaran (Rp)',
      'Sudah Kirim LoA',
    ];

    const rows = papers.map((p) => {
      // Nama/email penulis disimpan LANGSUNG di kolom paper_writers sendiri
      // (bukan via relasi .users — itu FK opsional yang hampir selalu null,
      // writer biasanya nggak punya akun users terkait).
      const writers = p.paper_writers.map((pw) => `${pw.first_name} ${pw.last_name}`.trim());
      const writerEmails = p.paper_writers.map((pw) => pw.email);
      const payment = p.payments?.[0];
      return csvRow([
        p.paper_id,
        p.paper_title,
        p.conference_papers_conference_idToconference?.conference_name ?? '',
        p.paper_status,
        p.conference_status ?? '',
        p.type ?? '',
        p.sub_theme ?? '',
        p.keywords ?? '',
        `${p.users?.first_name ?? ''} ${p.users?.last_name ?? ''}`.trim(),
        p.users?.email ?? '',
        writers.join('; '),
        writerEmails.join('; '),
        payment?.payment_status ?? '',
        payment?.total_amount != null ? formatRupiah(payment.total_amount as any) : '',
        p.sent_loa ? 'Ya' : 'Tidak',
      ]);
    });

    return [csvRow(headers), ...rows].join('\n');
  }

  async exportPaymentsCsv(conferenceId?: string): Promise<string> {
    const payments = await this.prisma.payments.findMany({
      where: conferenceId
        ? { papers: { conference_id: conferenceId } }
        : {},
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
      },
      orderBy: { payment_id: 'asc' },
    });

    const headers = [
      'Payment ID',
      'Conference',
      'Paper ID',
      'Judul Paper',
      'Submitter',
      'Email Submitter',
      'Status Pembayaran',
      'Total Amount (Rp)',
      'Due Date',
      'Sudah Kirim Invoice',
      'Penulis (Item Tagihan)',
      'Email Penulis',
      'Fee Penulis (Rp)',
      'Is Member',
    ];

    const rows: string[] = [];
    for (const pay of payments) {
      const conference =
        pay.papers?.conference_papers_conference_idToconference?.conference_name ?? '';
      const invoiceLines = pay.invoices ?? [];
      if (invoiceLines.length === 0) {
        rows.push(
          csvRow([
            pay.payment_id,
            conference,
            pay.papers?.paper_id ?? '',
            pay.papers?.paper_title ?? pay.description ?? '',
            `${pay.users?.first_name ?? ''} ${pay.users?.last_name ?? ''}`.trim(),
            pay.users?.email ?? '',
            pay.payment_status ?? '',
            pay.total_amount != null ? formatRupiah(pay.total_amount as any) : '',
            pay.due_date ? new Date(pay.due_date).toLocaleDateString('id-ID') : '',
            pay.sent_invoice ? 'Ya' : 'Tidak',
            '',
            '',
            '',
            '',
          ]),
        );
      } else {
        for (const inv of invoiceLines) {
          rows.push(
            csvRow([
              pay.payment_id,
              conference,
              pay.papers?.paper_id ?? '',
              pay.papers?.paper_title ?? pay.description ?? '',
              `${pay.users?.first_name ?? ''} ${pay.users?.last_name ?? ''}`.trim(),
              pay.users?.email ?? '',
              pay.payment_status ?? '',
              pay.total_amount != null ? formatRupiah(pay.total_amount as any) : '',
              pay.due_date ? new Date(pay.due_date).toLocaleDateString('id-ID') : '',
              pay.sent_invoice ? 'Ya' : 'Tidak',
              `${inv.paper_writers.first_name} ${inv.paper_writers.last_name}`.trim(),
              inv.paper_writers.email,
              // nominal disimpan sebagai string di tabel invoices (bukan Decimal) —
              // format manual aja, nggak lewat formatRupiah yang nunggu number/bigint.
              Number.isNaN(Number(inv.nominal)) ? inv.nominal : `Rp${Number(inv.nominal).toLocaleString('id-ID')}`,
              inv.paper_writers.member_status ? 'Member' : 'Non-Member',
            ]),
          );
        }
      }
    }

    return [csvRow(headers), ...rows].join('\n');
  }

  async exportParticipantsCsv(conferenceId?: string): Promise<string> {
    const participants = await this.prisma.participant.findMany({
      where: conferenceId ? { conference_id: conferenceId } : {},
      select: {
        attendance_id: true,
        payment_status: true,
        total_amount: true,
        is_member: true,
        role: true,
        sent_invoice: true,
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

    const headers = [
      'Attendance ID',
      'Nama',
      'Email',
      'Conference',
      'Role',
      'Is Member',
      'Status Pembayaran',
      'Total Amount (Rp)',
      'Sudah Kirim Invoice',
    ];

    const rows = participants.map((p) =>
      csvRow([
        p.attendance_id,
        `${p.users?.first_name ?? ''} ${p.users?.last_name ?? ''}`.trim(),
        p.users?.email ?? '',
        p.conference?.conference_name ?? '',
        p.role ?? '',
        p.is_member ? 'Member' : 'Non-Member',
        p.payment_status ?? '',
        p.total_amount != null ? formatRupiah(p.total_amount) : '',
        p.sent_invoice ? 'Ya' : 'Tidak',
      ]),
    );

    return [csvRow(headers), ...rows].join('\n');
  }
}
