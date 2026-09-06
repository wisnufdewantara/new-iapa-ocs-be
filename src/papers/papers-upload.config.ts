import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

// Upload baru (Submit Paper dst) disimpan di disk server sendiri, BUKAN
// Supabase Storage — keputusan user biar newocs independen dari Supabase
// untuk data baru (lihat SESSION_NOTES.md). Folder di luar dist/ biar
// nggak kehapus tiap `npm run build`.
export const PAPERS_UPLOAD_DIR = join(process.cwd(), 'uploads', 'papers');

if (!existsSync(PAPERS_UPLOAD_DIR)) {
  mkdirSync(PAPERS_UPLOAD_DIR, { recursive: true });
}

export const papersUploadOptions = {
  storage: diskStorage({
    destination: PAPERS_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new BadRequestException('Dokumen paper harus berformat PDF'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};
