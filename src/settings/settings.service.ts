import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { AuditLogService } from '../common/audit-log.service';

// Katalog key System Settings beneran (level infrastruktur aplikasi),
// BUKAN lagi tempat nyantol setting per-conference (itu sekarang di
// conference_settings, lihat ConferenceController). Baris yang belum
// ada di app_settings dianggap kosong ("" ), bukan error.
export const SYSTEM_SETTING_KEYS = [
  { key: 'smtp.host', label: 'SMTP Host' },
  { key: 'smtp.port', label: 'SMTP Port' },
  { key: 'smtp.user', label: 'SMTP User' },
  { key: 'smtp.password', label: 'SMTP Password' },
  { key: 'smtp.from_name', label: 'Nama Pengirim Email' },
  { key: 'payment_gateway.api_key', label: 'Payment Gateway API Key' },
  { key: 'payment.bank_name', label: 'Nama Bank' },
  { key: 'payment.bank_holder', label: 'Nama Pemilik Rekening' },
  { key: 'payment.bank_account_number', label: 'Nomor Rekening' },
] as const;

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    const rows = await this.prisma.app_settings.findMany({
      where: { setting_key: { in: SYSTEM_SETTING_KEYS.map((k) => k.key) } },
    });
    const byKey = new Map(rows.map((r) => [r.setting_key, r]));
    return SYSTEM_SETTING_KEYS.map(({ key, label }) => ({
      settingKey: key,
      label,
      settingValue: byKey.get(key)?.setting_value ?? '',
    }));
  }

  async update(key: string, value: string, actorUserId?: string) {
    const known = SYSTEM_SETTING_KEYS.find((k) => k.key === key);
    if (!known) {
      throw new Error(`Setting key tidak dikenal: ${key}`);
    }
    const updated = await this.prisma.app_settings.upsert({
      where: { setting_key: key },
      create: { setting_key: key, label: known.label, setting_value: value, updated_at: new Date() },
      update: { setting_value: value, updated_at: new Date() },
    });
    await this.auditLog.log(actorUserId, 'update_setting', 'app_settings', key);
    return updated;
  }

  async systemInfo() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../../package.json');
    let dbConnected = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbConnected = false;
    }
    return { version: pkg.version as string, dbConnected };
  }

  async testSmtp(actorUserId: string) {
    const user = await this.prisma.users.findUnique({ where: { user_id: actorUserId }, select: { email: true } });
    if (!user) throw new Error('User tidak ditemukan');
    await this.mailer.sendMail(
      user.email,
      'Test SMTP — newocs',
      '<p>Ini email percobaan dari halaman System Settings newocs. Kalau kamu menerima ini, konfigurasi SMTP sudah benar.</p>',
    );
    return { sent: true, to: user.email };
  }

  auditLogRecent(limit: number) {
    return this.auditLog.findRecent(limit);
  }
}
