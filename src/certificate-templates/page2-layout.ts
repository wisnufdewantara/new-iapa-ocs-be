import type { PDFFont } from 'pdf-lib';

export type Page2Block = { type: 'bullet' | 'paragraph' | 'space'; text: string };

// Parser SAMA PERSIS dipakai di FE (src/components/certificate-editor/page2.ts)
// buat preview — format baris: "- "/"* " = bullet, baris kosong = spasi,
// lainnya = paragraf. Sengaja sederhana (bukan markdown penuh).
export function parsePage2Content(content: string): Page2Block[] {
  return content.split('\n').map((line): Page2Block => {
    const trimmed = line.trim();
    if (trimmed === '') return { type: 'space', text: '' };
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return { type: 'bullet', text: trimmed.slice(2) };
    }
    return { type: 'paragraph', text: trimmed };
  });
}

export type LaidOutLine = { text: string; x: number; y: number; size: number };

// Word-wrap + hanging indent buat bullet, bisa meluber ke beberapa
// "halaman" (array of pages) kalau kontennya panjang.
export function layoutPage2(
  blocks: Page2Block[],
  font: PDFFont,
  size: number,
  W: number,
  H: number,
  startY: number,
  totalJp: number | null,
): LaidOutLine[][] {
  const marginX = 0.08 * W;
  const maxWidth = W - marginX * 2;
  const lineHeight = size * 1.4;
  const bulletGlyph = '•';
  const bulletIndent = size * 1.2;

  const pages: LaidOutLine[][] = [[]];
  let y = startY;
  let pageIdx = 0;

  const ensureRoom = () => {
    if (y < marginX) {
      pageIdx += 1;
      pages[pageIdx] = [];
      y = H - marginX;
    }
  };

  const wrapWords = (text: string, firstLineIndent: number, hangingIndent: number) => {
    const words = text.split(/\s+/).filter(Boolean);
    let line = '';
    let first = true;
    const flush = () => {
      ensureRoom();
      pages[pageIdx].push({ text: line, x: marginX + (first ? firstLineIndent : hangingIndent), y, size });
      y -= lineHeight;
      first = false;
      line = '';
    };
    for (const word of words) {
      const indent = first ? firstLineIndent : hangingIndent;
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth - indent && line) {
        flush();
        line = word;
      } else {
        line = test;
      }
    }
    if (line) flush();
  };

  for (const block of blocks) {
    if (block.type === 'space') {
      y -= lineHeight * 0.6;
      continue;
    }
    if (block.type === 'bullet') {
      ensureRoom();
      pages[pageIdx].push({ text: bulletGlyph, x: marginX, y, size });
      wrapWords(block.text, bulletIndent, bulletIndent);
      continue;
    }
    wrapWords(block.text, 0, 0);
  }

  if (totalJp != null) {
    y -= lineHeight * 0.3;
    ensureRoom();
    pages[pageIdx].push({ text: `Total: ${totalJp} JP`, x: marginX, y, size: size * 1.1 });
  }

  return pages;
}
