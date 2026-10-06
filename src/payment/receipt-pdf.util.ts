import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');

// Menggunakan template Kwitansi.pdf yang baru yang sudah dikosongkan tengahnya
const TEMPLATE_PATH = join(process.cwd(), 'assets', 'templates', 'Kwitansi.pdf');
const FONT_REGULAR_PATH = join(process.cwd(), 'assets', 'fonts', 'Inter_18pt-Regular.ttf');
const FONT_BOLD_PATH = join(process.cwd(), 'assets', 'fonts', 'Inter_18pt-SemiBold.ttf');

const navy = rgb(22 / 255, 58 / 255, 125 / 255);
const black = rgb(0, 0, 0);
const gray = rgb(0.45, 0.45, 0.45);

export async function generateReceiptPdf(params: {
  recipientName: string;
  amount: number;
  description: string;
  receiptNumber?: string;
}): Promise<Buffer> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const fontRegularBytes = readFileSync(FONT_REGULAR_PATH);
  const fontBoldBytes = readFileSync(FONT_BOLD_PATH);

  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const fontRegular = await pdfDoc.embedFont(fontRegularBytes, { subset: false });
  const fontBold = await pdfDoc.embedFont(fontBoldBytes, { subset: false });

  const page = pdfDoc.getPages()[0];
  const w = page.getWidth();
  const h = page.getHeight();

  const breakText = (text: string, maxWidth: number, font: any, fontSize: number): string[] => {
    const lines: string[] = [];
    let currentLine = '';
    const words = text.split(/\s+/);
    
    for (const word of words) {
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        if (currentLine) { lines.push(currentLine); currentLine = ''; }
        let temp = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(temp + char, fontSize) > maxWidth) {
            lines.push(temp);
            temp = char;
          } else {
            temp += char;
          }
        }
        if (temp) currentLine = temp;
        continue;
      }

      const testLine = currentLine ? currentLine + ' ' + word : word;
      if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  };

  const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const bx = 55; // Left margin
  let curY = h * 0.8; // Start from top, below the logos

  // ── Title ──────────────────────────────────────────────────────────────
  page.drawText('PAYMENT RECEIPT', {
    x: bx, y: curY,
    size: 24, font: fontBold, color: navy,
  });
  curY -= 25;

  // ── Date + Receipt number ───────────────────────────────────────────────
  const smallSz = 9;
  page.drawText(`Receipt Date: ${dateStr}`, {
    x: bx, y: curY, size: smallSz, font: fontRegular, color: gray,
  });
  if (params.receiptNumber) {
    page.drawText(`No.: ${params.receiptNumber}`, {
      x: 300, y: curY, size: smallSz, font: fontRegular, color: gray,
    });
  }
  curY -= 40;

  // ── Body ────────────────────────────────────────────────────────────────
  const bodySz = 11;
  const boldSz = 12;

  // Salutation
  page.drawText(`Dear ${params.recipientName},`, {
    x: bx, y: curY, size: boldSz, font: fontBold, color: black,
  });
  curY -= 25;

  // Opening paragraph
  const line1 = 'On behalf of the Organizing Committee of IAPA Annual Conference 2026,';
  const line2 = 'we hereby acknowledge receipt of payment for the following:';
  page.drawText(line1, { x: bx, y: curY, size: bodySz, font: fontRegular, color: black }); curY -= 18;
  page.drawText(line2, { x: bx, y: curY, size: bodySz, font: fontRegular, color: black }); curY -= 30;

  // Fields
  const labelX = bx;
  const colonX = bx + 95;
  const valueX = bx + 110;

  page.drawText('Description', { x: labelX, y: curY, size: bodySz, font: fontRegular, color: black });
  page.drawText(':', { x: colonX, y: curY, size: bodySz, font: fontRegular, color: black });
  
  const descMaxWidth = w - valueX - 55;
  const descLines = breakText(params.description, descMaxWidth, fontBold, boldSz);
  
  for (const line of descLines) {
    page.drawText(line, { x: valueX, y: curY, size: boldSz, font: fontBold, color: black });
    curY -= 16;
  }
  curY -= 6; // extra padding after description

  page.drawText('Amount Received', { x: labelX, y: curY, size: bodySz, font: fontRegular, color: black });
  page.drawText(':', { x: colonX, y: curY, size: bodySz, font: fontRegular, color: black });
  page.drawText(rupiah(params.amount), { x: valueX, y: curY, size: boldSz, font: fontBold, color: navy });
  curY -= 40;

  // Closing
  const cl1 = 'This receipt confirms that the above payment has been received in full.';
  const cl2 = 'Please retain this document as your official proof of payment.';
  const cl3 = 'We look forward to welcoming you to the Conference!';
  page.drawText(cl1, { x: bx, y: curY, size: bodySz, font: fontRegular, color: black }); curY -= 18;
  page.drawText(cl2, { x: bx, y: curY, size: bodySz, font: fontRegular, color: black }); curY -= 18;
  page.drawText(cl3, { x: bx, y: curY, size: bodySz, font: fontRegular, color: black });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
