import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync, unlinkSync } from 'fs';
import { join } from 'path';
import { diskStorage } from 'multer';

// File feedback reviewer (paper yang udah dikasih komentar) — fitur "Send
// Feedback" ocs2 lama. Disimpan di BAWAH uploads/papers/ biar otomatis
// ikut ketutup blokir akses publik /api/uploads/papers/ di main.ts;
// aksesnya cuma lewat link bertoken (signedFeedbackUrl di papers.service).
export const PAPER_FEEDBACK_UPLOAD_DIR = join(process.cwd(), 'uploads', 'papers', 'feedback');

if (!existsSync(PAPER_FEEDBACK_UPLOAD_DIR)) {
  mkdirSync(PAPER_FEEDBACK_UPLOAD_DIR, { recursive: true });
}

// Ekstensi diturunkan dari mimetype yang kita petakan sendiri, bukan
// dari nama file kiriman client (pola sama kayak payment-upload.config).
const EXT_BY_MIMETYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

export const paperFeedbackUploadOptions = {
  storage: diskStorage({
    destination: PAPER_FEEDBACK_UPLOAD_DIR,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${randomUUID()}${EXT_BY_MIMETYPE[file.mimetype] ?? ''}`);
    },
  }),
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!EXT_BY_MIMETYPE[file.mimetype]) {
      cb(new BadRequestException('File feedback harus PDF, DOC, atau DOCX'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};

// mimetype cuma klaim client — cek signature byte awal file beneran:
// PDF "%PDF", DOCX = zip "PK\x03\x04", DOC = OLE "D0 CF 11 E0".
const MAGIC_BY_MIMETYPE: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4b, 0x03, 0x04],
  'application/msword': [0xd0, 0xcf, 0x11, 0xe0],
};

export function assertValidFeedbackFile(diskPath: string, mimetype: string): void {
  const magic = MAGIC_BY_MIMETYPE[mimetype];
  const head = Buffer.alloc(4);
  let read = 0;
  try {
    const fd = openSync(diskPath, 'r');
    read = readSync(fd, head, 0, 4, 0);
    closeSync(fd);
  } catch {
    read = 0;
  }
  if (magic && read === 4 && magic.every((b, i) => head[i] === b)) return;
  try {
    unlinkSync(diskPath);
  } catch {
    // udah nggak ada — aman diabaikan
  }
  throw new BadRequestException('File feedback tidak valid atau rusak');
}
