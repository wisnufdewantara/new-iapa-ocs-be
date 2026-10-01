import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { EmailTemplateService } from '../email-template/email-template.service';
import { CertificateTemplatesService } from '../certificate-templates/certificate-templates.service';
import { CertificateRendererService } from '../certificate-templates/certificate-renderer.service';
import { IssuedCertificatesService } from '../certificate-templates/issued-certificates.service';
import { CERT_TYPE_KEY, CertificateType } from '../certificate-templates/certificate-types';

const TEMPLATE_PATH = join(process.cwd(), 'assets', 'templates', 'Certificate_2026.pdf');
const FONT_PATH = join(process.cwd(), 'assets', 'fonts', 'DMSerifDisplay-Italic.ttf');

// Kerangka ukur referensi template (1084 x 750), niru posisi persis dari
// CertificateServiceImpl.java (CMS-IAPA-BE) — satu template dipakai
// semua tipe, nama peran dicetak program, bukan dibakukan di file PDF.
// Ini adalah FALLBACK LEGACY — dipakai kalau conference belum dikonfigurasi
// lewat sistem template baru (certificate-templates/), lihat renderFor().
const REF_H = 750;
const TEXT_COLOR = rgb(23 / 255, 54 / 255, 106 / 255);

export type { CertificateType };

interface ResolvedRecipient {
  name: string;
  email: string;
  firstName: string;
  conferenceId: string | null;
  attendanceId: string;
  writerId: string | null;
  paperTitle: string | null;
  paperAcceptedAt: Date | null;
  conferenceName: string;
  conferenceDate: Date;
}

@Injectable()
export class CertificateService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private emailTemplate: EmailTemplateService,
    private templates: CertificateTemplatesService,
    private renderer: CertificateRendererService,
    private issued: IssuedCertificatesService,
  ) {}

  // Dua tab niru domain Attendance yang sudah ada (Tim/Presenter vs
  // Peserta) — cuma dua kelompok itu yang tercatat kehadirannya di
  // newocs. Ditambah data best_paper/best_presenter buat tab Special
  // Awards.
  async listByConference(conferenceId: string) {
    const [presenters, participantAttendance, conference] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { conference_id: conferenceId, presence: true, writer_id: { not: null } },
        include: { paper_writers: true },
      }),
      this.prisma.attendance.findMany({
        where: { conference_id: conferenceId, presence: true, participant_id: { not: null } },
        include: { participant: { include: { users: true } } },
      }),
      this.prisma.conference.findUnique({
        where: { conference_id: conferenceId },
        include: {
          papers_conference_best_paperTopapers: {
            include: { paper_writers: { where: { role: 'presenter' } } },
          },
          paper_writers: true,
        },
      }),
    ]);

    return {
      presenters: presenters.map((a) => ({
        attendanceId: a.id,
        writerId: a.paper_writers?.writer_id ?? null,
        name: a.paper_writers ? `${a.paper_writers.first_name} ${a.paper_writers.last_name}` : '-',
        sentCertificate: a.sent_ecertificate,
      })),
      participants: participantAttendance.map((a) => ({
        attendanceId: a.id,
        name: a.participant?.users ? `${a.participant.users.first_name} ${a.participant.users.last_name}` : '-',
        sentCertificate: a.sent_ecertificate,
      })),
      awards: {
        bestPaper: conference?.papers_conference_best_paperTopapers
          ? {
              paperId: conference.papers_conference_best_paperTopapers.paper_id,
              paperTitle: conference.papers_conference_best_paperTopapers.paper_title,
              presenterName: conference.papers_conference_best_paperTopapers.paper_writers[0]
                ? `${conference.papers_conference_best_paperTopapers.paper_writers[0].first_name} ${conference.papers_conference_best_paperTopapers.paper_writers[0].last_name}`
                : null,
            }
          : null,
        bestPresenter: conference?.paper_writers
          ? { writerId: conference.paper_writers.writer_id, name: `${conference.paper_writers.first_name} ${conference.paper_writers.last_name}` }
          : null,
        paperCertificateSent: conference?.paper_certificate_sent ?? false,
        presenterCertificateSent: conference?.presenter_certificate_sent ?? false,
      },
    };
  }

  // Fallback lama — satu template PDF hardcoded, dipakai kalau conference
  // belum dikonfigurasi lewat sistem certificate-templates/ (lihat
  // renderFor di bawah). TIDAK diubah logic-nya sama sekali.
  private async generateLegacyPdf(name: string, roleLabel: CertificateType): Promise<Buffer> {
    const templateBytes = readFileSync(TEMPLATE_PATH);
    const fontBytes = readFileSync(FONT_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    const page = pdfDoc.getPages()[0];
    const w = page.getWidth();
    const h = page.getHeight();

    const nameFontSize = (44 / REF_H) * h;
    const nameY = h - (304 / REF_H) * h;
    const roleFontSize = (30 / REF_H) * h;
    const roleY = h - (382 / REF_H) * h;

    const nameWidth = font.widthOfTextAtSize(name, nameFontSize);
    page.drawText(name, { x: (w - nameWidth) / 2, y: nameY, size: nameFontSize, font, color: TEXT_COLOR });

    const roleWidth = font.widthOfTextAtSize(roleLabel, roleFontSize);
    page.drawText(roleLabel, { x: (w - roleWidth) / 2, y: roleY, size: roleFontSize, font, color: TEXT_COLOR });

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  // Titik tunggal buat semua generate sertifikat (presenter/participant):
  // resolve template conference ini dulu, kalau nggak ada -> fallback
  // generator lama (byte-for-byte, conference yang belum disentuh admin
  // nggak kena efek apa pun).
  private async renderFor(r: ResolvedRecipient, type: CertificateType): Promise<Buffer> {
    const certType = CERT_TYPE_KEY[type];
    const template = await this.templates.resolveTemplate(r.conferenceId, certType);
    if (!template) return this.generateLegacyPdf(r.name, type);

    let verificationUrl: string | undefined;
    const eventDate = r.paperAcceptedAt ?? r.conferenceDate;
    if (template.qr_enabled) {
      const issuedRow = await this.issued.issue({
        certType,
        recipientName: r.name,
        eventTitle: r.paperTitle ?? r.conferenceName,
        conferenceName: r.conferenceName,
        eventDate,
        eventDateSource: r.paperAcceptedAt ? 'paper_accepted' : 'conference_date',
        conferenceId: r.conferenceId,
        attendanceId: r.attendanceId,
        writerId: r.writerId,
        templateId: template.id,
      });
      verificationUrl = this.issued.buildVerificationUrl(issuedRow.verification_code);
    }

    // Variabel buat interpolasi {{...}} di placeholder teks manual (lihat
    // certificate-placeholder-variables.constant.ts).
    const variables: Record<string, string> = {
      name: r.name,
      certType: type,
      conferenceName: r.conferenceName,
      paperTitle: r.paperTitle ?? '',
      eventDate: eventDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    };

    return this.renderer.render(template, { recipientName: r.name, certTypeLabel: type, verificationUrl, variables });
  }

  private async attendanceRecipient(attendanceId: string): Promise<ResolvedRecipient> {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: {
        paper_writers: { include: { papers: true } },
        participant: { include: { users: true } },
        conference: true,
      },
    });
    if (!attendance) throw new NotFoundException('Data kehadiran tidak ditemukan');

    const conferenceId = attendance.conference_id;
    const conferenceName = attendance.conference?.conference_name ?? '';
    const conferenceDate = attendance.conference?.conference_date ?? new Date();

    if (attendance.paper_writers) {
      return {
        name: `${attendance.paper_writers.first_name} ${attendance.paper_writers.last_name}`,
        email: attendance.paper_writers.email,
        firstName: attendance.paper_writers.first_name,
        conferenceId,
        attendanceId,
        writerId: attendance.paper_writers.writer_id,
        paperTitle: attendance.paper_writers.papers?.paper_title ?? null,
        paperAcceptedAt: attendance.paper_writers.papers?.accepted_at ?? null,
        conferenceName,
        conferenceDate,
      };
    }
    if (attendance.participant?.users) {
      return {
        name: `${attendance.participant.users.first_name} ${attendance.participant.users.last_name}`,
        email: attendance.participant.users.email,
        firstName: attendance.participant.users.first_name,
        conferenceId,
        attendanceId,
        writerId: null,
        paperTitle: null,
        paperAcceptedAt: null,
        conferenceName,
        conferenceDate,
      };
    }
    throw new NotFoundException('Data penerima sertifikat tidak lengkap');
  }

  async send(attendanceId: string, type: CertificateType) {
    const recipient = await this.attendanceRecipient(attendanceId);
    const pdfBytes = await this.renderFor(recipient, type);
    const { subject, bodyHtml } = await this.emailTemplate.render('certificate', { name: recipient.name, type });
    await this.mailer.sendMail(
      recipient.email,
      subject,
      bodyHtml,
      [{ filename: `Sertifikat-${attendanceId}.pdf`, content: pdfBytes }],
      { type: 'certificate', relatedId: attendanceId },
    );
    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: { sent_ecertificate: true, certificate_url: `/api/certificates/${attendanceId}/download?type=${encodeURIComponent(type)}` },
    });
    return { sent: true };
  }

  async sendBulk(items: { attendanceId: string; type: CertificateType }[]) {
    const results: { attendanceId: string; sent: boolean; error?: string }[] = [];
    for (const item of items) {
      try {
        await this.send(item.attendanceId, item.type);
        results.push({ attendanceId: item.attendanceId, sent: true });
      } catch (e: any) {
        results.push({ attendanceId: item.attendanceId, sent: false, error: e.message });
      }
    }
    return results;
  }

  async downloadByAttendance(attendanceId: string, type: CertificateType) {
    const recipient = await this.attendanceRecipient(attendanceId);
    return this.renderFor(recipient, type);
  }

  async sendAward(conferenceId: string, award: 'best_paper' | 'best_presenter') {
    const conference = await this.prisma.conference.findUnique({
      where: { conference_id: conferenceId },
      include: {
        papers_conference_best_paperTopapers: { include: { paper_writers: { where: { role: 'presenter' } } } },
        paper_writers: { include: { papers: true } },
      },
    });
    if (!conference) throw new NotFoundException('Conference tidak ditemukan');

    if (award === 'best_paper') {
      const presenter = conference.papers_conference_best_paperTopapers?.paper_writers[0];
      const bestPaper = conference.papers_conference_best_paperTopapers;
      if (!presenter || !bestPaper) throw new NotFoundException('Best Paper belum diatur untuk conference ini');
      const recipient: ResolvedRecipient = {
        name: `${presenter.first_name} ${presenter.last_name}`,
        email: presenter.email,
        firstName: presenter.first_name,
        conferenceId,
        attendanceId: '',
        writerId: presenter.writer_id,
        paperTitle: bestPaper.paper_title,
        paperAcceptedAt: bestPaper.accepted_at ?? null,
        conferenceName: conference.conference_name,
        conferenceDate: conference.conference_date,
      };
      const pdfBytes = await this.renderFor(recipient, 'Best Paper');
      const { subject, bodyHtml } = await this.emailTemplate.render('certificate_award', {
        firstName: presenter.first_name,
        awardLabel: 'Best Paper',
      });
      await this.mailer.sendMail(
        presenter.email,
        subject,
        bodyHtml,
        [{ filename: `Sertifikat-BestPaper-${conferenceId}.pdf`, content: pdfBytes }],
        { type: 'certificate_award', relatedId: conferenceId },
      );
      await this.prisma.conference.update({ where: { conference_id: conferenceId }, data: { paper_certificate_sent: true } });
    } else {
      const writer = conference.paper_writers;
      if (!writer) throw new NotFoundException('Best Presenter belum diatur untuk conference ini');
      const recipient: ResolvedRecipient = {
        name: `${writer.first_name} ${writer.last_name}`,
        email: writer.email,
        firstName: writer.first_name,
        conferenceId,
        attendanceId: '',
        writerId: writer.writer_id,
        paperTitle: writer.papers?.paper_title ?? null,
        paperAcceptedAt: writer.papers?.accepted_at ?? null,
        conferenceName: conference.conference_name,
        conferenceDate: conference.conference_date,
      };
      const pdfBytes = await this.renderFor(recipient, 'Best Presenter');
      const { subject, bodyHtml } = await this.emailTemplate.render('certificate_award', {
        firstName: writer.first_name,
        awardLabel: 'Best Presenter',
      });
      await this.mailer.sendMail(
        writer.email,
        subject,
        bodyHtml,
        [{ filename: `Sertifikat-BestPresenter-${conferenceId}.pdf`, content: pdfBytes }],
        { type: 'certificate_award', relatedId: conferenceId },
      );
      await this.prisma.conference.update({ where: { conference_id: conferenceId }, data: { presenter_certificate_sent: true } });
    }
    return { sent: true };
  }
}
