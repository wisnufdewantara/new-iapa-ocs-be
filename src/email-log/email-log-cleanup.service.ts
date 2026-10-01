import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailLogService } from './email-log.service';

// Auto-hapus log email yang lebih tua dari retensi (30 hari, lihat
// EMAIL_LOG_RETENTION_DAYS). Tabel ini murni buat monitoring jangka pendek,
// bukan arsip permanen — biar nggak numpuk nggak terbatas.
@Injectable()
export class EmailLogCleanupService {
  private readonly logger = new Logger(EmailLogCleanupService.name);

  constructor(private emailLogService: EmailLogService) {}

  // Tiap hari jam 03:00 server.
  @Cron('0 3 * * *')
  async cleanupScheduled() {
    try {
      const deleted = await this.emailLogService.cleanupOld();
      if (deleted > 0) this.logger.log(`Email log cleanup: hapus ${deleted} baris > 30 hari.`);
    } catch (e: any) {
      this.logger.error(`Email log cleanup gagal: ${e.message}`);
    }
  }
}
