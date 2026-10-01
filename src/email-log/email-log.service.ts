import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const EMAIL_LOG_RETENTION_DAYS = 30;

@Injectable()
export class EmailLogService {
  constructor(private prisma: PrismaService) {}

  // Daftar log buat halaman Mail Log Monitoring. Filter opsional: type,
  // status ('sent'/'failed'), q (cari di recipient/subject). Dibatesin
  // `limit` (default 200, maks 500) biar nggak narik ribuan baris.
  async list(params: { type?: string; status?: string; q?: string; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const where: any = {};
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.q) {
      where.OR = [
        { recipient: { contains: params.q, mode: 'insensitive' } },
        { subject: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.email_log.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    // error dipotong di FE; track_token TIDAK diekspos (dipakai di URL pixel).
    return rows.map((r) => ({
      id: r.id,
      recipient: r.recipient,
      subject: r.subject,
      type: r.type,
      status: r.status,
      error: r.error,
      relatedId: r.related_id,
      openedAt: r.opened_at,
      openCount: r.open_count,
      createdAt: r.created_at,
    }));
  }

  // Ringkasan buat kartu di atas tabel: total, terkirim, gagal, kebuka.
  async stats() {
    const [total, sent, failed, opened] = await Promise.all([
      this.prisma.email_log.count(),
      this.prisma.email_log.count({ where: { status: 'sent' } }),
      this.prisma.email_log.count({ where: { status: 'failed' } }),
      this.prisma.email_log.count({ where: { opened_at: { not: null } } }),
    ]);
    return { total, sent, failed, opened, retentionDays: EMAIL_LOG_RETENTION_DAYS };
  }

  // Dipanggil endpoint pixel publik pas email dibuka. Best-effort: sekali
  // panggil set opened_at (pertama kali) + naikin open_count.
  async markOpened(token: string) {
    const log = await this.prisma.email_log.findUnique({ where: { track_token: token }, select: { id: true, opened_at: true } });
    if (!log) return;
    await this.prisma.email_log.update({
      where: { id: log.id },
      data: { open_count: { increment: 1 }, opened_at: log.opened_at ?? new Date() },
    });
  }

  // Hapus log lebih tua dari retensi. Dipanggil cron harian + bisa manual.
  async cleanupOld(): Promise<number> {
    const cutoff = new Date(Date.now() - EMAIL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const res = await this.prisma.email_log.deleteMany({ where: { created_at: { lt: cutoff } } });
    return res.count;
  }
}
