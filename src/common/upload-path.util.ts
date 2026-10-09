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

// Bukti transfer hasil sync dari ocs2 lama disimpan sebagai URL absolut
// Supabase Storage (bukan file lokal) — itu harus di-redirect, bukan
// dicari di disk. Cuma https ke host Supabase yang dianggap "remote"
// (hindari open redirect kalau isi kolom aneh-aneh).
export type StoredFileLocation = { kind: 'remote'; url: string } | { kind: 'disk'; path: string };

export function resolveStoredFile(url: string): StoredFileLocation {
  if (/^https?:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('URL file tidak valid');
    }
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
      throw new BadRequestException('URL file tidak valid');
    }
    return { kind: 'remote', url: parsed.toString() };
  }
  return { kind: 'disk', path: uploadUrlToDiskPath(url) };
}
