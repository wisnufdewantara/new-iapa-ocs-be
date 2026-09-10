import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

// Baca konfigurasi SMTP live dari app_settings (bukan .env), supaya
// perubahan dari tombol "Test SMTP" di /admin/settings langsung kepakai
// tanpa restart/deploy backend.
@Injectable()
export class MailerService {
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

  async sendMail(to: string, subject: string, html: string, attachments?: { filename: string; content: Buffer }[]) {
    const config = await this.getConfig();
    if (!config.host || !config.user) {
      throw new Error('SMTP belum dikonfigurasi. Isi dulu di /admin/settings.');
    }
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.user}>`,
      to,
      subject,
      html,
      attachments,
    });
  }
}
