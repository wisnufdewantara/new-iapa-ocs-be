import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CertType } from './certificate-types';

export interface IssueInput {
  certType: CertType;
  recipientName: string;
  eventTitle: string;
  conferenceName: string;
  eventDate: Date;
  eventDateSource: 'paper_accepted' | 'conference_date';
  conferenceId?: string | null;
  attendanceId?: string | null;
  writerId?: string | null;
  templateId: string;
}

@Injectable()
export class IssuedCertificatesService {
  constructor(private prisma: PrismaService) {}

  // Idempotent: dedupe_key sama -> baris lama di-update (snapshot refresh,
  // kode verifikasi TETAP SAMA), bukan bikin baris baru tiap download/kirim.
  async issue(input: IssueInput) {
    const dedupeKey = this.buildDedupeKey(input);
    const existing = await this.prisma.issued_certificates.findUnique({ where: { dedupe_key: dedupeKey } });
    if (existing) {
      const updated = await this.prisma.issued_certificates.update({
        where: { id: existing.id },
        data: {
          recipient_name: input.recipientName,
          event_title: input.eventTitle,
          conference_name: input.conferenceName,
          event_date: input.eventDate,
          event_date_source: input.eventDateSource,
          template_id: input.templateId,
        },
      });
      return updated;
    }
    return this.prisma.issued_certificates.create({
      data: {
        verification_code: randomBytes(16).toString('hex'),
        dedupe_key: dedupeKey,
        cert_type: input.certType,
        recipient_name: input.recipientName,
        event_title: input.eventTitle,
        conference_name: input.conferenceName,
        event_date: input.eventDate,
        event_date_source: input.eventDateSource,
        conference_id: input.conferenceId ?? null,
        attendance_id: input.attendanceId ?? null,
        writer_id: input.writerId ?? null,
        template_id: input.templateId,
      },
    });
  }

  buildVerificationUrl(code: string) {
    const base = process.env.FRONTEND_URL || 'https://dev-ocs.iapa.or.id';
    return `${base}/certificate-validation/${code}`;
  }

  private buildDedupeKey(input: IssueInput) {
    if (input.certType === 'best_paper' || input.certType === 'best_presenter') {
      return `award:${input.conferenceId}:${input.certType}:${input.writerId}`;
    }
    return `att:${input.attendanceId}:${input.certType}`;
  }
}
