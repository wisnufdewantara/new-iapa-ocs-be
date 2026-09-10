// Niru persis PaymentTypeServiceImpl.applyUniqueCode (Java lama): bulatkan
// nominal ke atas ke ribuan terdekat, ganti 3 digit terakhir dengan kode
// unik, kalau hasilnya masih kurang dari nominal asli tambah 1000 lagi —
// jadi nominal transfer SELALU >= nominal tagihan.
const STEP = 1000;

export function applyUniqueCode(amount: number, uniqueCode: string): number {
  const codeValue = Number(uniqueCode);
  const whole = Math.ceil(amount);
  let transfer = whole - (whole % STEP) + codeValue;
  if (transfer < amount) transfer += STEP;
  return transfer;
}
