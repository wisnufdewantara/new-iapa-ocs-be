import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

// Sama seperti papers-upload.config.ts: disk lokal server, bukan Supabase
// Storage. Bukti transfer biasanya screenshot (gambar), jadi terima
// gambar juga, bukan cuma PDF kayak dokumen paper.
export const PAYMENT_PROOF_UPLOAD_DIR = join(process.cwd(), 'uploads', 'payment-proofs');

if (!existsSync(PAYMENT_PROOF_UPLOAD_DIR)) {
  mkdirSync(PAYMENT_PROOF_UPLOAD_DIR, { recursive: true });
}

export const paymentProofUploadOptions = {
  storage: diskStorage({
    destination: PAYMENT_PROOF_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (file.mimetype !== 'application/pdf' && !file.mimetype.startsWith('image/')) {
      cb(new BadRequestException('Bukti transfer harus berupa gambar atau PDF'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};
