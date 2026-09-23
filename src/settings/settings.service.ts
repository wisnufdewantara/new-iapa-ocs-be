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
  { key: 'payment.method.manual_transfer_enabled', label: 'Metode: Transfer Manual aktif' },
  { key: 'payment.bank_name', label: 'Nama Bank' },
  { key: 'payment.bank_holder', label: 'Nama Pemilik Rekening' },
  { key: 'payment.bank_account_number', label: 'Nomor Rekening' },
  { key: 'payment.deadline_text', label: 'Tenggat Pembayaran (teks bebas, mis. "7 hari setelah invoice diterima")' },
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
    return SYSTEM_SETTING_KEYS.map(({ key, label }) => {
      const raw = byKey.get(key)?.setting_value ?? '';
      // smtp.password JANGAN PERNAH dikirim balik ke frontend dalam
      // bentuk asli — sebelumnya GET /settings ngembaliin plaintext-nya
      // mentah-mentah walau di UI cuma dirender sebagai <input
      // type="password"> (itu cuma nyembunyiin visual, nilai aslinya
      // tetap ada utuh di response API/DOM). Sentinel dipakai biar admin
      // masih bisa lihat "udah ke-set atau belum" tanpa expose isinya;
      // dianggap "diubah" cuma kalau draft-nya beda dari sentinel ini.
      const settingValue = key === 'smtp.password' ? (raw ? '••••••••' : '') : raw;
      return { settingKey: key, label, settingValue };
    });
  }

  async update(key: string, value: string, actorUserId?: string) {
    const known = SYSTEM_SETTING_KEYS.find((k) => k.key === key);
    if (!known) {
      throw new Error(`Setting key tidak dikenal: ${key}`);
    }
    // Jaga-jaga: sentinel masking di findAll() harusnya udah nyegah FE
    // ngirim balik nilai ini secara nggak sengaja (dianggap "unchanged"),
    // tapi kalau ada request langsung ke API (bukan lewat UI) yang somehow
    // ngirim sentinel-nya mentah-mentah, tolak daripada nimpa password
    // asli jadi literal "••••••••".
    if (key === 'smtp.password' && value === '••••••••') {
      throw new Error('Nilai tidak valid untuk smtp.password');
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

  async testSmtp(actorUserId: string, to?: string) {
    const user = await this.prisma.users.findUnique({ where: { user_id: actorUserId }, select: { email: true } });
    if (!user) throw new Error('User tidak ditemukan');
    const recipient = to || user.email;
    await this.mailer.sendMail(
      recipient,
      'Test SMTP — newocs',
      '<p>Ini email percobaan dari halaman System Settings newocs. Kalau kamu menerima ini, konfigurasi SMTP sudah benar.</p>',
    );
    return { sent: true, to: recipient };
  }

  auditLogRecent(limit: number) {
    return this.auditLog.findRecent(limit);
  }
}
