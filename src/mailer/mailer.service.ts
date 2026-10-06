import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

// Baca konfigurasi SMTP live dari app_settings (bukan .env), supaya
// perubahan dari tombol "Test SMTP" di /admin/settings langsung kepakai
// tanpa restart/deploy backend.
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private prisma: PrismaService) {}

  private async getConfig() {
    const rows = await this.prisma.app_settings.findMany({
      where: { setting_key: { in: ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.password', 'smtp.from_name'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      host: map['smtp.host'] || '',
      port: Number(map['smtp.port']) || 587,
      user: map['smtp.user'] || '',
      password: map['smtp.password'] || '',
      fromName: map['smtp.from_name'] || 'newocs',
    };
  }

  // URL publik backend buat tracking pixel "read". Kalau BACKEND_URL kosong,
  // pixel nggak diinject (tracking read nonaktif) — email tetap kekirim.
  private openPixelHtml(token: string): string {
    const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
    if (!base) return '';
    const src = `${base}/api/email-track/open/${token}.png`;
    return `<img src="${src}" alt="" width="1" height="1" style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden" />`;
  }

  // opts.type = kategori email (loa|invoice|receipt|certificate|certificate_award|
  // password_reset|test|other) buat difilter di Mail Log Monitoring.
  // opts.relatedId = id domain terkait (paperId/paymentId/dll) buat navigasi.
  async sendMail(
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: Buffer }[],
    opts?: { type?: string; relatedId?: string },
  ) {
    const config = await this.getConfig();
    if (!config.host || !config.user) {
      throw new Error('SMTP belum dikonfigurasi. Isi dulu di /admin/settings.');
    }

    // Catat baris log DULU supaya dapet track_token buat pixel. Status
    // diisi belakangan ('sent'/'failed') setelah percobaan kirim.
    let logId: string | null = null;
    let trackToken: string | null = null;
    try {
      const log = await this.prisma.email_log.create({
        data: { recipient: to, subject, status: 'sent', type: opts?.type || 'other', related_id: opts?.relatedId ?? null },
        select: { id: true, track_token: true },
      });
      logId = log.id;
      trackToken = log.track_token;
    } catch (e: any) {
      // Logging gagal TIDAK boleh ngehalangin email kekirim — fitur monitoring
      // bersifat sekunder. Catat ke server log aja, lanjut kirim tanpa pixel.
      this.logger.warn(`Gagal nyatet email_log (lanjut kirim tanpa tracking): ${e.message}`);
    }

    const finalHtml = trackToken ? html + this.openPixelHtml(trackToken) : html;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });

    try {
      await transporter.sendMail({
        from: `"${config.fromName}" <${config.user}>`,
        to,
        subject,
        html: finalHtml,
        attachments,
      });
    } catch (err: any) {
      // Tandai log 'failed' tapi JANGAN telan error — caller (loa/invoice/
      // certificate/dll) masih ngandelin throw buat tau kirim gagal.
      if (logId) {
        await this.prisma.email_log
          .update({ where: { id: logId }, data: { status: 'failed', error: String(err?.message ?? err).slice(0, 2000) } })
          .catch(() => undefined);
      }
      throw err;
    }
  }
}
