import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { extname } from 'path';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');
import * as QRCode from 'qrcode';
import { loadFontBytes } from './certificate-fonts.constant';
import { uploadUrlToDiskPath } from './certificate-file.util';
import { layoutPage2, parsePage2Content } from './page2-layout';

// Semua posisi di template disimpan sebagai FRAKSI 0..1 dari lebar(x)/
// tinggi(y) HALAMAN PDF, menandai TITIK TENGAH elemen — lihat komentar di
// prisma/schema.prisma model certificate_templates.
type TemplateWithSigners = {
  design_image_url: string;
  design_width_px: number;
  design_height_px: number;
  name_font_key: string;
  name_font_size: number;
  name_color: string;
  name_pos_x: number;
  name_pos_y: number;
  name_max_width: number;
  label_enabled: boolean;
  label_font_size: number;
  label_pos_x: number;
  label_pos_y: number;
  body_font_key: string;
  signer_font_size: number;
  signer_color: string;
  page2_enabled: boolean;
  page2_title: string | null;
  page2_content: string | null;
  page2_total_jp: number | null;
  page2_font_size: number;
  qr_enabled: boolean;
  qr_pos_x: number;
  qr_pos_y: number;
  qr_size: number;
  certificate_template_signers: {
    slot: number;
    signer_name: string;
    signer_title: string | null;
    signature_image_url: string | null;
    signature_width_px: number | null;
    signature_height_px: number | null;
    pos_x: number;
    pos_y: number;
    width: number;
  }[];
};

export interface RenderContext {
  recipientName: string;
  certTypeLabel: string;
  verificationUrl?: string;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

@Injectable()
export class CertificateRendererService {
  // Generalisasi dari logic centering yang sudah ada di
  // certificate.service.ts lama — dipakai buat nama, label, nama/jabatan
  // signer, dan judul halaman 2.
  drawCenteredText(page: PDFPage, font: PDFFont, text: string, cx: number, cy: number, size: number, color: ReturnType<typeof rgb>) {
    const width = font.widthOfTextAtSize(text, size);
    const ascent = font.heightAtSize(size, { descender: false });
    const total = font.heightAtSize(size);
    const descent = total - ascent;
    const baselineY = cy - (ascent - descent) / 2;
    page.drawText(text, { x: cx - width / 2, y: baselineY, size, font, color });
    return width;
  }

  async render(template: TemplateWithSigners, ctx: RenderContext): Promise<Buffer> {
    const W = 842;
    const H = (W * template.design_height_px) / template.design_width_px;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const page = pdfDoc.addPage([W, H]);

    const designBytes = readFileSync(uploadUrlToDiskPath(template.design_image_url));
    const ext = extname(template.design_image_url).toLowerCase();
    const designImage = ext === '.png' ? await pdfDoc.embedPng(designBytes) : await pdfDoc.embedJpg(designBytes);
    page.drawImage(designImage, { x: 0, y: 0, width: W, height: H });

    const nameFont = await pdfDoc.embedFont(loadFontBytes(template.name_font_key), { subset: false });
    const bodyFont = await pdfDoc.embedFont(loadFontBytes(template.body_font_key), { subset: false });

    // Nama: auto-shrink kalau lebih lebar dari name_max_width.
    let nameSize = template.name_font_size * H;
    const maxNameWidth = template.name_max_width * W;
    const rawWidth = nameFont.widthOfTextAtSize(ctx.recipientName, nameSize);
    if (rawWidth > maxNameWidth) {
      nameSize *= maxNameWidth / rawWidth;
    }
    this.drawCenteredText(
      page,
      nameFont,
      ctx.recipientName,
      template.name_pos_x * W,
      H * (1 - template.name_pos_y),
      nameSize,
      hexToRgb(template.name_color),
    );

    if (template.label_enabled) {
      this.drawCenteredText(
        page,
        bodyFont,
        ctx.certTypeLabel,
        template.label_pos_x * W,
        H * (1 - template.label_pos_y),
        template.label_font_size * H,
        hexToRgb(template.name_color),
      );
    }

    for (const signer of template.certificate_template_signers) {
      const cx = signer.pos_x * W;
      const cy = H * (1 - signer.pos_y);
      const signerColor = hexToRgb(template.signer_color);
      const nameSize2 = template.signer_font_size * H;
      if (signer.signature_image_url && signer.signature_width_px && signer.signature_height_px) {
        const sigBytes = readFileSync(uploadUrlToDiskPath(signer.signature_image_url));
        const sigExt = extname(signer.signature_image_url).toLowerCase();
        const sigImage = sigExt === '.png' ? await pdfDoc.embedPng(sigBytes) : await pdfDoc.embedJpg(sigBytes);
        const imgW = signer.width * W;
        const imgH = imgW * (signer.signature_height_px / signer.signature_width_px);
        page.drawImage(sigImage, { x: cx - imgW / 2, y: cy - imgH / 2, width: imgW, height: imgH });
        this.drawCenteredText(page, bodyFont, signer.signer_name, cx, cy - imgH / 2 - nameSize2 * 0.6, nameSize2, signerColor);
        if (signer.signer_title) {
          this.drawCenteredText(page, bodyFont, signer.signer_title, cx, cy - imgH / 2 - nameSize2 * 1.8, nameSize2 * 0.85, signerColor);
        }
      } else {
        this.drawCenteredText(page, bodyFont, signer.signer_name, cx, cy, nameSize2, signerColor);
        if (signer.signer_title) {
          this.drawCenteredText(page, bodyFont, signer.signer_title, cx, cy - nameSize2 * 1.2, nameSize2 * 0.85, signerColor);
        }
      }
    }

    if (template.qr_enabled && ctx.verificationUrl) {
      const qrPngBuffer = await QRCode.toBuffer(ctx.verificationUrl, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 600 });
      const qrImage = await pdfDoc.embedPng(qrPngBuffer);
      const s = template.qr_size * W;
      page.drawImage(qrImage, { x: template.qr_pos_x * W - s / 2, y: H * (1 - template.qr_pos_y) - s / 2, width: s, height: s });
    }

    if (template.page2_enabled && template.page2_content) {
      const page2 = pdfDoc.addPage([W, H]);
      page2.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
      const fontSize = template.page2_font_size * H;
      let startY = H - 0.1 * W;
      if (template.page2_title) {
        this.drawCenteredText(page2, bodyFont, template.page2_title, W / 2, startY, fontSize * 1.5, hexToRgb(template.signer_color));
        startY -= fontSize * 1.5 * 1.8;
      }
      const blocks = parsePage2Content(template.page2_content);
      const laidOutPages = layoutPage2(blocks, bodyFont, fontSize, W, H, startY, template.page2_total_jp);
      laidOutPages.forEach((lines, idx) => {
        const target = idx === 0 ? page2 : pdfDoc.addPage([W, H]);
        if (idx > 0) target.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
        for (const line of lines) {
          target.drawText(line.text, { x: line.x, y: line.y, size: line.size, font: bodyFont, color: hexToRgb(template.signer_color) });
        }
      });
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}
