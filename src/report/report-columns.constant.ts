export interface ReportColumn {
  key: string;
  label: string;
}

// Urutan di sini = urutan default kolom di file export (CSV/XLSX) —
// pilihan kolom dari client (query param `columns`) CUMA memfilter yang
// mana ikut, urutannya tetap ngikut array ini, BUKAN urutan client kirim
// (biar konsisten & gampang diprediksi, dan nggak perlu validasi urutan).
export const PAPERS_COLUMNS: ReportColumn[] = [
  { key: 'paperId', label: 'Paper ID' },
  { key: 'paperTitle', label: 'Judul Paper' },
  { key: 'conference', label: 'Conference' },
  { key: 'paperStatus', label: 'Status Paper' },
  { key: 'conferenceStatus', label: 'Status Conference' },
  { key: 'type', label: 'Tipe' },
  { key: 'subTheme', label: 'Sub Tema' },
  { key: 'keywords', label: 'Keywords' },
  { key: 'submitterName', label: 'Submitter' },
  { key: 'submitterEmail', label: 'Email Submitter' },
  { key: 'writers', label: 'Penulis (semua)' },
  { key: 'writerEmails', label: 'Email Penulis' },
  { key: 'paymentStatus', label: 'Status Pembayaran' },
  { key: 'totalPayment', label: 'Total Pembayaran (Rp)' },
  { key: 'sentLoa', label: 'Sudah Kirim LoA' },
];

export const PAYMENTS_COLUMNS: ReportColumn[] = [
  { key: 'paymentId', label: 'Payment ID' },
  { key: 'conference', label: 'Conference' },
  { key: 'paperId', label: 'Paper ID' },
  { key: 'paperTitle', label: 'Judul Paper' },
  { key: 'submitterName', label: 'Submitter' },
  { key: 'submitterEmail', label: 'Email Submitter' },
  { key: 'paymentStatus', label: 'Status Pembayaran' },
  { key: 'totalAmount', label: 'Total Amount (Rp)' },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'sentInvoice', label: 'Sudah Kirim Invoice' },
  { key: 'writerName', label: 'Penulis (Item Tagihan)' },
  { key: 'writerEmail', label: 'Email Penulis' },
  { key: 'writerFee', label: 'Fee Penulis (Rp)' },
  { key: 'isMember', label: 'Is Member' },
];

export const PARTICIPANTS_COLUMNS: ReportColumn[] = [
  { key: 'attendanceId', label: 'Attendance ID' },
  { key: 'name', label: 'Nama' },
  { key: 'email', label: 'Email' },
  { key: 'conference', label: 'Conference' },
  { key: 'role', label: 'Role' },
  { key: 'isMember', label: 'Is Member' },
  { key: 'paymentStatus', label: 'Status Pembayaran' },
  { key: 'totalAmount', label: 'Total Amount (Rp)' },
  { key: 'sentInvoice', label: 'Sudah Kirim Invoice' },
];

// Filter+reorder kolom berdasar query param `columns` (comma-separated
// key) — kalau kosong/nggak dikirim, balikin SEMUA kolom (perilaku lama,
// backward compatible). Key yang nggak dikenal diam-diam diabaikan
// (bukan error) — ini fitur UI non-kritis, nggak perlu nolak keras.
export function resolveColumns(all: ReportColumn[], columnsParam?: string): ReportColumn[] {
  if (!columnsParam) return all;
  const requested = new Set(
    columnsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const filtered = all.filter((c) => requested.has(c.key));
  return filtered.length > 0 ? filtered : all;
}
