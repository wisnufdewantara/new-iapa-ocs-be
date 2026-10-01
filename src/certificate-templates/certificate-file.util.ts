import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join, normalize, resolve } from 'path';
import { PDFDocument } from 'pdf-lib';

const UPLOADS_ROOT = resolve(process.cwd(), 'uploads');

// Baca dimensi gambar lewat embed pdf-lib (bukan `sharp`, biar nggak nambah
// dependency) — sekalian nolak file yang mimetype-nya dipalsukan (decode
// gagal = BadRequestException, bukan nyimpen data rusak).
export async function readImageMeta(diskPath: string, mimetype: string): Promise<{ width: number; height: number }> {
  const bytes = readFileSync(diskPath);
  const probe = await PDFDocument.create();
  try {
    const image = mimetype === 'image/png' ? await probe.embedPng(bytes) : await probe.embedJpg(bytes);
    return { width: image.width, height: image.height };
  } catch {
    throw new BadRequestException('File gambar tidak valid atau rusak');
  }
}

// Konversi path publik (/api/uploads/<fitur>/<file>) balik ke path disk,
// buat renderer baca ulang bytes-nya pas generate PDF — sekalian pastiin
// hasilnya nggak "kabur" keluar dari folder uploads/.
export function uploadUrlToDiskPath(url: string): string {
  const rel = url.replace(/^\/api\/uploads\//, '');
  const diskPath = normalize(join(UPLOADS_ROOT, rel));
  if (!diskPath.startsWith(UPLOADS_ROOT)) {
    throw new BadRequestException('Path file tidak valid');
  }
  return diskPath;
}
