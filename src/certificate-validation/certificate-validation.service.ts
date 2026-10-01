import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CODE_FORMAT = /^[a-f0-9]{32}$/;

@Injectable()
export class CertificateValidationService {
  constructor(private prisma: PrismaService) {}

  // Endpoint PUBLIK — baca HANYA dari snapshot issued_certificates, nggak
  // pernah join ke users/papers live. Response cuma 6 field whitelist di
  // bawah, lihat komentar di model issued_certificates (schema.prisma).
  async validate(code: string) {
    if (!CODE_FORMAT.test(code)) {
      throw new NotFoundException('Sertifikat tidak ditemukan');
    }
    const row = await this.prisma.issued_certificates.findUnique({ where: { verification_code: code } });
    if (!row || row.is_revoked) {
      throw new NotFoundException('Sertifikat tidak ditemukan');
    }
    return {
      recipientName: row.recipient_name,
      certType: row.cert_type,
      eventTitle: row.event_title,
      conferenceName: row.conference_name,
      eventDate: row.event_date.toISOString().slice(0, 10),
      issuedAt: row.issued_at,
    };
  }
}
