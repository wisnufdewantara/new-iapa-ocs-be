import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

// Pola sama seperti papers-upload.config.ts / payment-upload.config.ts:
// disk lokal server, bukan Supabase Storage.
export const POSTERS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'posters');

if (!existsSync(POSTERS_UPLOAD_DIR)) {
  mkdirSync(POSTERS_UPLOAD_DIR, { recursive: true });
}

export const posterUploadOptions = {
  storage: diskStorage({
    destination: POSTERS_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new BadRequestException('Poster harus berupa gambar'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
};
