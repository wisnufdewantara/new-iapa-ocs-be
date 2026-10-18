import { presenterFee } from './pricing.constant';

// Logika fee presenter versi PURE (tanpa Prisma, tanpa nulis ke DB) —
// dipindah dari PaymentService biar bisa dipakai juga buat ESTIMASI
// read-only (dashboard keuangan), tanpa harus manggil ensureCalculated
// yang nge-update baris payments + push ke ocs2. Perilakunya HARUS tetap
// sama persis dengan yang dipakai PaymentService (yang sekarang cuma
// delegasi ke sini) — kalau aturan fee berubah, cukup ubah di sini.

export type FeeWriter = {
  writer_id: string;
  member_status: boolean | null;
  payment_override: string | null;
  manual_fee: unknown;
};

// Cari writer yang match submitter (by user_id, fallback email) di antara
// writer role 'presenter' — sama persis dengan
// PaymentService.findSubmitterWriter, cuma datanya disuplai pemanggil.
export function matchSubmitterWriter<W extends { user_id: string | null; email: string }>(
  presenterWriters: W[],
  submitterId: string | null | undefined,
  submitterEmail: string | null | undefined,
): W | null {
  let submitterWriter = presenterWriters.find((w) => w.user_id === submitterId);
  if (!submitterWriter && submitterId) {
    submitterWriter = presenterWriters.find((w) => w.email === submitterEmail);
  }
  return submitterWriter ?? null;
}

export function effectiveFee(
  writer: { member_status: boolean | null; payment_override: string | null; manual_fee: unknown },
  isSubmitter: boolean,
): number {
  if (writer.manual_fee != null) return Number(writer.manual_fee);
  if (isSubmitter && !writer.payment_override) return presenterFee(writer.member_status);
  return 0;
}

// Total = jumlah effectiveFee semua writer. null = submitter nggak ketemu
// DAN nggak ada manual_fee sama sekali (lihat komentar di PaymentService).
export function computePresenterTotal(writers: FeeWriter[], submitterWriter: { writer_id: string } | null): number | null {
  const hasManualFee = writers.some((w) => w.manual_fee != null);
  if (!submitterWriter && !hasManualFee) return null;
  return writers.reduce((sum, w) => sum + effectiveFee(w, w.writer_id === submitterWriter?.writer_id), 0);
}
