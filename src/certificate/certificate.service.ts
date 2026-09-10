import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

const TEMPLATE_PATH = join(process.cwd(), 'assets', 'templates', 'Certificate_2026.pdf');
const FONT_PATH = join(process.cwd(), 'assets', 'fonts', 'DMSerifDisplay-Italic.ttf');

// Kerangka ukur referensi template (1084 x 750), niru posisi persis dari
// CertificateServiceImpl.java (CMS-IAPA-BE) — satu template dipakai
// semua tipe, nama peran dicetak program, bukan dibakukan di file PDF.
const REF_H = 750;
const TEXT_COLOR = rgb(23 / 255, 54 / 255, 106 / 255);

export type CertificateType = 'Participant' | 'Presenter' | 'Best Paper' | 'Best Presenter';

@Injectable()
export class CertificateService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
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

  async generatePdf(name: string, roleLabel: CertificateType): Promise<Buffer> {
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

  private async attendanceRecipient(attendanceId: string) {
    const attendance = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { paper_writers: true, participant: { include: { users: true } } },
    });
    if (!attendance) throw new NotFoundException('Data kehadiran tidak ditemukan');
    if (attendance.paper_writers) {
      return { name: `${attendance.paper_writers.first_name} ${attendance.paper_writers.last_name}`, email: attendance.paper_writers.email };
    }
    if (attendance.participant?.users) {
      return { name: `${attendance.participant.users.first_name} ${attendance.participant.users.last_name}`, email: attendance.participant.users.email };
    }
    throw new NotFoundException('Data penerima sertifikat tidak lengkap');
  }

  async send(attendanceId: string, type: CertificateType) {
    const recipient = await this.attendanceRecipient(attendanceId);
    const pdfBytes = await this.generatePdf(recipient.name, type);
    await this.mailer.sendMail(
      recipient.email,
      `Sertifikat ${type} — IAPA Conference`,
      `<p>Dear ${recipient.name},</p><p>Terlampir e-sertifikat Anda sebagai <strong>${type}</strong>.</p>`,
      [{ filename: `Sertifikat-${attendanceId}.pdf`, content: pdfBytes }],
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
    return this.generatePdf(recipient.name, type);
  }

  async sendAward(conferenceId: string, award: 'best_paper' | 'best_presenter') {
    const conference = await this.prisma.conference.findUnique({
      where: { conference_id: conferenceId },
      include: {
        papers_conference_best_paperTopapers: { include: { paper_writers: { where: { role: 'presenter' } } } },
        paper_writers: true,
      },
    });
    if (!conference) throw new NotFoundException('Conference tidak ditemukan');

    if (award === 'best_paper') {
      const presenter = conference.papers_conference_best_paperTopapers?.paper_writers[0];
      if (!presenter) throw new NotFoundException('Best Paper belum diatur untuk conference ini');
      const pdfBytes = await this.generatePdf(`${presenter.first_name} ${presenter.last_name}`, 'Best Paper');
      await this.mailer.sendMail(
        presenter.email,
        'Sertifikat Best Paper — IAPA Conference',
        `<p>Dear ${presenter.first_name},</p><p>Selamat! Terlampir e-sertifikat Best Paper Anda.</p>`,
        [{ filename: `Sertifikat-BestPaper-${conferenceId}.pdf`, content: pdfBytes }],
      );
      await this.prisma.conference.update({ where: { conference_id: conferenceId }, data: { paper_certificate_sent: true } });
    } else {
      const writer = conference.paper_writers;
      if (!writer) throw new NotFoundException('Best Presenter belum diatur untuk conference ini');
      const pdfBytes = await this.generatePdf(`${writer.first_name} ${writer.last_name}`, 'Best Presenter');
      await this.mailer.sendMail(
        writer.email,
        'Sertifikat Best Presenter — IAPA Conference',
        `<p>Dear ${writer.first_name},</p><p>Selamat! Terlampir e-sertifikat Best Presenter Anda.</p>`,
        [{ filename: `Sertifikat-BestPresenter-${conferenceId}.pdf`, content: pdfBytes }],
      );
      await this.prisma.conference.update({ where: { conference_id: conferenceId }, data: { presenter_certificate_sent: true } });
    }
    return { sent: true };
  }
}
