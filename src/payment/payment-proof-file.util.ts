import { BadRequestException } from '@nestjs/common';
import { readFileSync, unlinkSync } from 'fs';
import { PDFDocument } from 'pdf-lib';

// Validasi ISI file bukti transfer SETELAH ditulis ke disk oleh multer —
// file.mimetype yang dipakai fileFilter cuma klaim client (gampang
// dipalsukan lewat Content-Type multipart), jadi di sini kita beneran
// decode byte-nya. Kalau gagal decode (bukan PDF/PNG/JPEG asli walau
// ekstensinya udah dibatasi di payment-upload.config.ts), file dihapus
// & request ditolak — jangan sampai ada file nyasar yang kontennya beda
// dari yang diklaim nempel di /api/uploads (diserve di origin yang sama
// kayak SPA admin, tanpa X-Content-Type-Options/CSP).
export async function assertValidProofFile(diskPath: string, mimetype: string): Promise<void> {
  const bytes = readFileSync(diskPath);
  try {
    if (mimetype === 'application/pdf') {
      await PDFDocument.load(bytes);
      return;
    }
    const probe = await PDFDocument.create();
    if (mimetype === 'image/png') {
      await probe.embedPng(bytes);
    } else {
      await probe.embedJpg(bytes);
    }
  } catch {
    try {
      unlinkSync(diskPath);
    } catch {
      // file udah kehapus/nggak ada — aman diabaikan
    }
    throw new BadRequestException('File bukti transfer tidak valid atau rusak');
  }
}
