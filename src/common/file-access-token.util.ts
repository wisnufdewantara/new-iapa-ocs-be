import { createHmac, timingSafeEqual } from 'crypto';

// File upload (dokumen paper, bukti transfer) sebelumnya diserve lewat
// static file PUBLIK (/api/uploads/..., nggak ada auth sama sekali) —
// siapapun yang punya/nebak URL-nya bisa akses, lepas dari login/role.
// Celah ini sudah ada dari awal fitur upload dibikin, BUKAN baru muncul
// gara-gara fitur laporan — tapi nambah link bukti bayar/dokumen ke
// laporan CSV/Excel bikin exposure-nya makin gampang kesebar (file bisa
// di-forward/disimpan siapa aja), jadi momen yang pas buat beneran
// ditutup sekalian.
//
// Fix: link yang dikasih ke frontend (baik di UI biasa MAUPUN di laporan)
// sekarang berupa "capability URL" — path + token HMAC yang discoped ke
// SATU resource spesifik + kedaluwarsa (bukan JWT biasa, karena link ini
// harus bisa diklik langsung sebagai <a href> / dari file Excel yang
// didownload, TIDAK BISA bawa header Authorization kayak fetch API biasa).
// Pengecekan hak akses (siapa boleh dapat link) tetap dicek SEKALI, pas
// link ini di-generate (di endpoint yang udah di-guard permission/login
// biasa) — endpoint yang nge-serve file-nya sendiri cuma validasi token,
// nggak perlu tau soal role/permission lagi.
const SECRET = process.env.JWT_SECRET as string;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari — laporan didownload buat diarsipkan/dipakai belakangan, bukan sekali pakai makanya nggak dibikin pendek kayak sesi login.

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function signFileToken(resource: string, id: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${resource}:${id}:${exp}`;
  return Buffer.from(`${payload}:${sign(payload)}`).toString('base64url');
}

export function verifyFileToken(token: string | undefined, resource: string, id: string): boolean {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return false;
    const [tResource, tId, tExp, tSig] = parts;
    if (tResource !== resource || tId !== id) return false;
    if (Date.now() > Number(tExp)) return false;
    const expectedSig = sign(`${tResource}:${tId}:${tExp}`);
    const a = Buffer.from(tSig);
    const b = Buffer.from(expectedSig);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
