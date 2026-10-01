import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

// Pola sama kayak poster-upload.config.ts — disk lokal server, diserve
// balik lewat static route /api/uploads yang udah ada di main.ts.
export const CERT_TEMPLATES_UPLOAD_DIR = join(process.cwd(), 'uploads', 'certificate-templates');
export const CERT_SIGNATURES_UPLOAD_DIR = join(process.cwd(), 'uploads', 'certificate-signatures');

for (const dir of [CERT_TEMPLATES_UPLOAD_DIR, CERT_SIGNATURES_UPLOAD_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// pdf-lib cuma bisa embed PNG/JPEG (bukan SVG/WebP) — SVG juga risiko XSS
// kalau diserve apa adanya lewat static route, jadi dibatasi di sini.
const imageOnlyFilter = (message: string) => (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
  if (file.mimetype !== 'image/png' && file.mimetype !== 'image/jpeg') {
    cb(new BadRequestException(message), false);
    return;
  }
  cb(null, true);
};

export const designUploadOptions = {
  storage: diskStorage({
    destination: CERT_TEMPLATES_UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`),
  }),
  fileFilter: imageOnlyFilter('Desain sertifikat harus berupa PNG atau JPEG'),
  limits: { fileSize: 10 * 1024 * 1024 },
};

// Signature khusus PNG (butuh transparansi) — ukuran kecil, bukan gambar
// penuh halaman kayak desain.
export const signatureUploadOptions = {
  storage: diskStorage({
    destination: CERT_SIGNATURES_UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`),
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (file.mimetype !== 'image/png') {
      cb(new BadRequestException('Tanda tangan harus berupa PNG (transparan)'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
};
