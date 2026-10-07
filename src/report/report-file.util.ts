import ExcelJS from 'exceljs';
import { ReportColumn } from './report-columns.constant';

/**
 * Netralkan CSV/formula injection (CWE-1236) — CUMA relevan buat CSV.
 * Excel men-tafsir ulang isi .csv seolah-olah diketik manual, jadi cell
 * yang diawali =/+/-/@/tab/CR ditafsir sebagai formula; prefix tanda
 * kutip tunggal maksa dianggap teks biasa (dan apostrof-nya nggak ikut
 * tampil, sama kayak kalau user ketik manual).
 *
 * TIDAK dipakai buat XLSX — di XLSX asli, cell string ditulis sebagai
 * elemen teks (<t>) murni, bukan formula (<f>), jadi exceljs/Excel NGGAK
 * PERNAH mengeksekusinya sebagai formula sekalipun isinya diawali "=".
 * Prefix apostrof di sana justru jadi karakter yang ketimpa tampil literal
 * (bug kosmetik), karena XLSX nggak re-parse teks kayak CSV.
 */
function sanitizeCsvValue(val: unknown): string {
  if (val == null) return '';
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return str;
}

function csvCell(val: unknown): string {
  const str = sanitizeCsvValue(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function buildCsv(rows: Record<string, unknown>[], columns: ReportColumn[]): string {
  const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');
  const headerRow = csvRow(columns.map((c) => c.label));
  const dataRows = rows.map((r) => csvRow(columns.map((c) => r[c.key])));
  return [headerRow, ...dataRows].join('\n');
}

export async function buildXlsx(
  rows: Record<string, unknown>[],
  columns: ReportColumn[],
  sheetName: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Nama sheet Excel dibatasi 31 karakter & nggak boleh karakter tertentu
  // ([]:*?/\) — potong + bersihin biar nggak gagal generate.
  const safeSheetName = sheetName.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1';
  const sheet = workbook.addWorksheet(safeSheetName);
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: 22 }));
  for (const r of rows) {
    const row: Record<string, string> = {};
    for (const c of columns) row[c.key] = r[c.key] == null ? '' : String(r[c.key]);
    sheet.addRow(row);
  }
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
