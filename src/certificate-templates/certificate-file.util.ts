import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { PDFDocument } from 'pdf-lib';

export { uploadUrlToDiskPath } from '../common/upload-path.util';

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
