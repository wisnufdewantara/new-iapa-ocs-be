import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fontkit = require('@pdf-lib/fontkit');

const TEMPLATE_PATH = join(process.cwd(), 'assets', 'templates', 'Invoice.pdf');
const FONT_PATH = join(process.cwd(), 'assets', 'fonts', 'Inter_18pt-Regular.ttf');

// Niru persis InvoiceServiceImpl.fillAuthorFeeInvoice di CMS-IAPA-BE (Java
// lama) — load TEMPLATE PDF asli ("Author Fee Invoice" bermerk IAPA,
// bukan halaman kosong) terus gambar CUMA nominal fee di atasnya. Bank/
// tenggat/tanda tangan dkk udah tercetak di desain templatenya sendiri
// (hasil export Google Docs), jadi nggak digambar ulang di sini — beda
// dari versi sebelumnya yang bikin PDF polos dari nol dan salah asumsi
// legacy nggak punya desain (ternyata ADA, cuma kelewat kecek).
// Koordinat diukur relatif terhadap kerangka desain 1012x674 (sama kayak
// Java), diskalakan ke ukuran halaman template yang sebenarnya.
const REF_W = 1012;
const REF_H = 674;
const TEXT_COLOR = rgb(0, 0, 0);

export async function generateInvoicePdf(params: { amount: number }): Promise<Buffer> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const fontBytes = readFileSync(FONT_PATH);
  const pdfDoc = await PDFDocument.load(templateBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });
  const page = pdfDoc.getPages()[0];
  const w = page.getWidth();
  const h = page.getHeight();

  const rupiah = `Rp${params.amount.toLocaleString('id-ID')}`;
  const fontSize = (14 / REF_H) * h;
  const valueX = (362 / REF_W) * w;
  const feeY = h - (243 / REF_H) * h;

  page.drawText(rupiah, { x: valueX, y: feeY, size: fontSize, font, color: TEXT_COLOR });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
