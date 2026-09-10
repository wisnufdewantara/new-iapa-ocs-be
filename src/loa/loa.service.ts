import { Injectable, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

const TEMPLATE_PATH = join(process.cwd(), 'assets', 'templates', 'LoA.pdf');
const FONT_PATH = join(process.cwd(), 'assets', 'fonts', 'Inter_18pt-SemiBold.ttf');

// Kerangka ukur referensi template LOA 2026 (827 x 1170), niru posisi
// persis dari LoaServiceImpl.java (CMS-IAPA-BE), lihat catatan di sana
// soal kenapa posisi dihitung dari BAWAH paragraf (setFixedPosition).
const REF_W = 827;
const REF_H = 1170;

function countWrappedLines(text: string, font: any, fontSize: number, maxWidth: number) {
  if (!text || !text.trim() || maxWidth <= 0) return 1;
  let lines = 1;
  let current = '';
  for (const word of text.trim().split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      lines++;
      current = word;
    } else {
      current = candidate;
    }
  }
  return lines;
}

function drawWrapped(page: any, font: any, text: string, x: number, topY: number, width: number, fontSize: number, lineHeight: number, color = rgb(0, 0, 0)) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, fontSize) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  lines.forEach((line, i) => {
    page.drawText(line, { x, y: topY - (i + 1) * lineHeight + (lineHeight - fontSize), size: fontSize, font, color });
  });
  return lines.length;
}

@Injectable()
export class LoaService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  findByConference(conferenceId: string) {
    return this.prisma.papers
      .findMany({
        where: { conference_id: conferenceId, conference_status: 'Accepted' },
        include: { users: true, paper_writers: true },
        orderBy: { paper_title: 'asc' },
      })
      .then((papers) =>
        papers.map((p) => ({
          paperId: p.paper_id,
          paperTitle: p.paper_title,
          submitterName: p.users ? `${p.users.first_name} ${p.users.last_name}` : '-',
          sentLoa: p.sent_loa,
        })),
      );
  }

  private async paperDetail(paperId: string) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      include: { users: true, paper_writers: true },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');
    if (!paper.users) throw new NotFoundException('Submitter paper tidak ditemukan');
    return paper;
  }

  async generatePdf(paperId: string): Promise<Buffer> {
    const paper = await this.paperDetail(paperId);
    const templateBytes = readFileSync(TEMPLATE_PATH);
    const fontBytes = readFileSync(FONT_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    const page = pdfDoc.getPages()[0];
    const w = page.getWidth();
    const h = page.getHeight();

    const recipientX = (140 / REF_W) * w;
    const titleX = (205 / REF_W) * w;
    const authorsX = (245 / REF_W) * w;
    const fontSize = (15 / REF_H) * h;
    const lineHeight = fontSize * 1.25;

    const recipientTopY = h - (193 / REF_H) * h;
    const titleTopY = h - (286 / REF_H) * h;
    const authorsTopY = h - (332 / REF_H) * h;

    const recipientWidth = w - recipientX - 60;
    const titleWidth = w - titleX - 60;
    const authorsWidth = w - authorsX - 60;

    const recipientText = `${paper.users!.first_name} ${paper.users!.last_name}`;
    const titleText = paper.paper_title;
    const authorsJoined = paper.paper_writers.map((a) => `${a.first_name} ${a.last_name}`).join(', ');

    let titleFontSize = fontSize;
    const minTitleFontSize = fontSize * 0.65;
    while (
      titleFontSize > minTitleFontSize &&
      countWrappedLines(titleText, font, titleFontSize, titleWidth) > 2
    ) {
      titleFontSize -= 0.3;
    }
    const titleLineHeight = titleFontSize * 1.25;

    drawWrapped(page, font, recipientText, recipientX, recipientTopY, recipientWidth, fontSize, lineHeight);
    drawWrapped(page, font, titleText, titleX, titleTopY, titleWidth, titleFontSize, titleLineHeight);
    drawWrapped(page, font, authorsJoined, authorsX, authorsTopY, authorsWidth, fontSize, lineHeight);

    await this.drawUniqueCodeNote(pdfDoc, page, font, w, h);

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  // Catatan kode unik pembayaran presenter, niru drawUniqueCodeNote() di
  // LoaServiceImpl.java. Baca kode unik dari tabel payment_types yang
  // sudah ada (domain Payment sendiri belum dibangun di newocs, tapi
  // datanya sudah ikut ter-copy dari database lama).
  private async drawUniqueCodeNote(pdfDoc: PDFDocument, page: any, font: any, w: number, h: number) {
    const paymentType = await this.prisma.payment_types.findUnique({ where: { type_key: 'presenter' } });
    const code = paymentType?.unique_code?.trim();
    if (!code) return;

    const noteText = `Payment Note: please transfer the exact amount shown on your payment page in the OCS system. The amount ends with our unique verification code ${code}. Transferring a rounded amount will delay the verification of your payment.`;

    const boxX = (100 / REF_W) * w;
    const boxWidth = (627 / REF_W) * w;
    const boxTopY = h - (910 / REF_H) * h;
    const fontSize = (12 / REF_H) * h;
    const lineHeight = fontSize * 1.35;
    const padX = (14 / REF_W) * w;
    const padY = (10 / REF_H) * h;
    const textWidth = boxWidth - 2 * padX;
    const lines = countWrappedLines(noteText, font, fontSize, textWidth);
    const boxHeight = lines * lineHeight + 2 * padY;
    const boxBottomY = boxTopY - boxHeight;

    page.drawRectangle({
      x: boxX,
      y: boxBottomY,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: rgb(22 / 255, 58 / 255, 125 / 255),
      borderWidth: 0.8,
    });
    drawWrapped(page, font, noteText, boxX + padX, boxTopY, textWidth, fontSize, lineHeight, rgb(22 / 255, 58 / 255, 125 / 255));
  }

  async send(paperId: string) {
    const paper = await this.paperDetail(paperId);
    const pdfBytes = await this.generatePdf(paperId);
    await this.mailer.sendMail(
      paper.users!.email,
      'Letter of Acceptance — IAPA Conference',
      `<p>Dear ${paper.users!.first_name},</p><p>Terlampir Letter of Acceptance untuk paper Anda: <strong>${paper.paper_title}</strong>.</p>`,
      [{ filename: `LoA-${paper.paper_id}.pdf`, content: pdfBytes }],
    );
    await this.prisma.papers.update({ where: { paper_id: paperId }, data: { sent_loa: true } });
    return { sent: true };
  }

  async sendBulk(paperIds: string[]) {
    const results: { paperId: string; sent: boolean; error?: string }[] = [];
    for (const id of paperIds) {
      try {
        await this.send(id);
        results.push({ paperId: id, sent: true });
      } catch (e: any) {
        results.push({ paperId: id, sent: false, error: e.message });
      }
    }
    return results;
  }
}
