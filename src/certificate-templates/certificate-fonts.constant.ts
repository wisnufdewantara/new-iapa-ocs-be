import { readFileSync } from 'fs';
import { join } from 'path';

// 5 font OFL (Google Fonts) buat template sertifikat baru. File .ttf
// statis (BUKAN variable font *[wght].ttf — fontkit cuma embed instance
// default, beratnya nggak bisa dipastikan) didownload manual & commit ke
// assets/fonts/ (lihat juga assets/fonts/licenses/ buat teks OFL-nya).
// Font key ini dipakai juga di FE (nama @font-face di index.css) — WAJIB
// disamain kalau ganti/nambah font.
export interface CertificateFontDef {
  label: string;
  file: string;
}

export const CERTIFICATE_FONTS: Record<string, CertificateFontDef> = {
  spectral_semibold: { label: 'Spectral SemiBold', file: 'Spectral-SemiBold.ttf' },
  crimson_semibold: { label: 'Crimson Text SemiBold', file: 'CrimsonText-SemiBold.ttf' },
  cardo_regular: { label: 'Cardo', file: 'Cardo-Regular.ttf' },
  great_vibes: { label: 'Great Vibes (Script)', file: 'GreatVibes-Regular.ttf' },
  tangerine_bold: { label: 'Tangerine Bold (Script)', file: 'Tangerine-Bold.ttf' },
};

export const FONT_KEYS = Object.keys(CERTIFICATE_FONTS);

const FONTS_DIR = join(process.cwd(), 'assets', 'fonts');
const fontBytesCache = new Map<string, Buffer>();

export function loadFontBytes(key: string): Buffer {
  const cached = fontBytesCache.get(key);
  if (cached) return cached;
  const def = CERTIFICATE_FONTS[key];
  if (!def) throw new Error(`Font key "${key}" tidak dikenal`);
  const bytes = readFileSync(join(FONTS_DIR, def.file));
  fontBytesCache.set(key, bytes);
  return bytes;
}
