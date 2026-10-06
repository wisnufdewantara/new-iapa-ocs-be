import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { diskStorage } from 'multer';

// Sama seperti papers-upload.config.ts: disk lokal server, bukan Supabase
// Storage. Bukti transfer biasanya screenshot (gambar), jadi terima
// gambar juga, bukan cuma PDF kayak dokumen paper.
export const PAYMENT_PROOF_UPLOAD_DIR = join(process.cwd(), 'uploads', 'payment-proofs');

if (!existsSync(PAYMENT_PROOF_UPLOAD_DIR)) {
  mkdirSync(PAYMENT_PROOF_UPLOAD_DIR, { recursive: true });
}

// Ekstensi file disimpan diturunkan dari mimetype yang KITA petakan sendiri,
// BUKAN dari file.originalname — originalname itu nama file yang diisi
// client, bisa apa aja (mis. "bukti.png" tapi isinya SVG+<script>). Dengan
// ekstensi dibatasi ke 3 pilihan ini (lalu bytes-nya divalidasi ulang di
// payment.controller.ts sebelum dipercaya), nggak ada cara file ke-simpen
// dengan ekstensi yang browser anggap executable (.html/.svg/.js dst).
const EXT_BY_MIMETYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export const paymentProofUploadOptions = {
  storage: diskStorage({
    destination: PAYMENT_PROOF_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${EXT_BY_MIMETYPE[file.mimetype] ?? ''}`);
    },
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    // Dibatasi ke 3 tipe konkret (bukan "image/*" terbuka) — image/svg+xml
    // termasuk "image/*" tapi XML-based dan bisa bawa <script>, jadi HARUS
    // ditolak eksplisit di sini, bukan keikutan lolos karena prefix match.
    if (!EXT_BY_MIMETYPE[file.mimetype]) {
      cb(new BadRequestException('Bukti transfer harus berupa PDF, PNG, atau JPEG'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};
