import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Beda dari LoA/Certificate: legacy nggak punya desain template buat
// invoice, cuma generate polos + email (dicek: InvoiceServiceImpl bikin
// PDF dari nol, bukan overlay template). Niru itu — bikin dari nol pakai
// font standar pdf-lib, tanpa aset gambar.
export async function generateInvoicePdf(params: {
  invoiceTitle: string;
  recipientName: string;
  description: string;
  amount: number;
  transferAmount: number;
  bankName: string;
  bankHolder: string;
  bankAccountNumber: string;
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
  let y = 780;
  const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    page.drawText(text, {
      x: 50,
      y,
      size: opts.size ?? 12,
      font: opts.bold ? bold : font,
      color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
    });
    y -= (opts.size ?? 12) * 1.6;
  };

  draw('IAPA Conference — Invoice Pembayaran', { size: 18, bold: true });
  y -= 10;
  draw(params.invoiceTitle, { size: 13, bold: true });
  y -= 6;
  draw(`Kepada: ${params.recipientName}`);
  draw(params.description);
  y -= 10;
  draw(`Nominal: ${rupiah(params.amount)}`);
  draw(`Jumlah yang harus ditransfer (dengan kode unik): ${rupiah(params.transferAmount)}`, { bold: true, color: [22 / 255, 58 / 255, 125 / 255] });
  y -= 10;
  draw('Transfer ke:', { bold: true });
  draw(`${params.bankName} — ${params.bankHolder}`);
  draw(`No. Rekening: ${params.bankAccountNumber}`);
  y -= 10;
  draw('Mohon transfer jumlah PERSIS sesuai nominal di atas (termasuk kode unik', { size: 10 });
  draw('3 digit terakhir) untuk memudahkan verifikasi pembayaran.', { size: 10 });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
