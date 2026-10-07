import { BadRequestException } from '@nestjs/common';
import { normalize, join, resolve } from 'path';

export const UPLOADS_ROOT = resolve(process.cwd(), 'uploads');

// Konversi path publik (/api/uploads/<fitur>/<file>) balik ke path disk —
// dipakai tiap kali butuh baca ulang bytes file yang udah di-upload
// (generate PDF, atau sekarang: stream lewat endpoint terautentikasi).
// Pastiin hasilnya nggak "kabur" keluar dari folder uploads/ (path
// traversal lewat ../../ di url).
export function uploadUrlToDiskPath(url: string): string {
  const rel = url.replace(/^\/api\/uploads\//, '');
  const diskPath = normalize(join(UPLOADS_ROOT, rel));
  if (!diskPath.startsWith(UPLOADS_ROOT)) {
    throw new BadRequestException('Path file tidak valid');
  }
  return diskPath;
}
