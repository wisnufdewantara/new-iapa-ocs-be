import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Dashboard developer (admin-only) — CUMA metrik sistem/agregat, TIDAK
// PERNAH mengembalikan data mentah/PII user atau secret apa pun (password,
// JWT_SECRET, dll). smtpConfigured cuma ngecek ADA/NGGAK nilainya, bukan
// isinya. Kalau nambah field baru di sini, pastikan tetap angka/boolean
// agregat, bukan baris data individual.
@Injectable()
export class DeveloperService {
  constructor(private prisma: PrismaService) {}

  async status() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json');

    const dbStart = Date.now();
    let dbConnected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbConnected = false;
    }
    const dbLatencyMs = Date.now() - dbStart;

    const smtpHost = await this.prisma.app_settings.findUnique({ where: { setting_key: 'smtp.host' } });

    const mem = process.memoryUsage();

    const [users, conferences, papers, participants, payments] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.conference.count(),
      this.prisma.papers.count(),
      this.prisma.participant.count(),
      this.prisma.payments.count(),
    ]);

    return {
      appVersion: pkg.version as string,
      nodeVersion: process.version,
      environment: process.env.APP_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      database: { connected: dbConnected, latencyMs: dbLatencyMs },
      smtpConfigured: Boolean(smtpHost?.setting_value),
      counts: { users, conferences, papers, participants, payments },
    };
  }
}
