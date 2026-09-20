import { Injectable, Logger } from '@nestjs/common';

// Jembatan SATU-SATUNYA arah newocs -> ocs2 (sistem lama, data asli yang
// masih dipakai peserta). Kebalikan dari scripts/sync-from-supabase.mjs
// yang searah Supabase -> newocs.
//
// AWALNYA dirancang connect langsung ke Postgres Supabase, tapi server
// Dewaweb (tempat newocs jalan) ternyata memblokir semua koneksi
// outbound ke port database (5432 & 6543 non-standar terbukti
// connection refused; cuma HTTPS/443 yang tembus). Dua jalur HTTPS
// dicoba berurutan, yang pertama berhasil dipakai:
//
//   1. Supabase REST API (PostgREST) langsung — pakai secret key baru
//      (sb_secret_...), schema sisko di-expose via GRANT manual (lihat
//      SESSION_NOTES.md). Ini yang aktif duluan karena nggak nunggu
//      deploy apa pun.
//   2. Endpoint internal di CMS-IAPA-BE (Railway) — jalur "resmi" yang
//      punya validasi lewat JPA. Fallback kalau REST API gagal/belum
//      di-setting, dan otomatis kepakai lagi begitu Railway kelar deploy.
//
// PENTING: match-nya pakai paper_id, BUKAN payment_id — payments.payment_id
// di newocs dan di ocs2 itu DUA UUID YANG BEDA untuk paper yang sama
// (masing-masing sistem bikin baris payment sendiri lewat trigger DB-nya
// sendiri pas paper di-accept). papers.paper_id yang reliable sama di
// kedua sistem (itu yang di-sync dengan pk asli).
@Injectable()
export class Ocs2SyncService {
  private readonly logger = new Logger(Ocs2SyncService.name);
  private warnedMissingSupabaseEnv = false;
  private warnedMissingInternalEnv = false;

  async pushPaymentTotalByPaperId(paperId: string, totalAmount: number, paymentStatus: string) {
    const viaSupabase = await this.pushViaSupabaseRest(paperId, { total_amount: totalAmount, payment_status: paymentStatus });
    if (viaSupabase) return;
    await this.pushViaOcs2InternalApi(paperId, totalAmount, paymentStatus);
  }

  // Dipakai buat aksi yang cuma ngubah status (Accept/Reject/Kirim Invoice),
  // BUKAN nominal — jadi total_amount di ocs2 nggak ikut disentuh/ditimpa.
  // Ini penting karena peserta masih ngecek status bayar di ocs2.iapa.or.id
  // (belum semua pindah ke newocs), jadi status verify/reject Apan di sini
  // WAJIB kelihatan di sana juga.
  async pushPaymentStatusByPaperId(paperId: string, paymentStatus: string, description?: string | null) {
    const fields: Record<string, unknown> = { payment_status: paymentStatus };
    if (description !== undefined) fields.description = description;
    await this.pushViaSupabaseRest(paperId, fields);
    // Fallback internal API belum support partial-field update (cuma
    // totalAmount+paymentStatus) — kalau REST API Supabase lagi bermasalah,
    // status-only push ini bakal skip dulu sampai itu diperluas juga.
  }

  async pushSentInvoiceByPaperId(paperId: string, sentInvoice: boolean) {
    await this.pushViaSupabaseRest(paperId, { sent_invoice: sentInvoice });
  }

  // Jalur 1: Supabase PostgREST langsung. Return true kalau berhasil
  // update minimal 1 baris (biar caller tau nggak perlu fallback lagi).
  private async pushViaSupabaseRest(paperId: string, fields: Record<string, unknown>): Promise<boolean> {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      if (!this.warnedMissingSupabaseEnv) {
        this.logger.warn('SUPABASE_URL/SUPABASE_SECRET_KEY belum diisi — jalur REST API Supabase di-skip.');
        this.warnedMissingSupabaseEnv = true;
      }
      return false;
    }
    try {
      const res = await fetch(`${url}/rest/v1/payments?paper_id=eq.${paperId}`, {
        method: 'PATCH',
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          'Content-Profile': 'sisko',
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        this.logger.warn(`Push via Supabase REST gagal untuk paper ${paperId}: HTTP ${res.status} ${await res.text()}`);
        return false;
      }
      const rows = (await res.json()) as unknown[];
      if (rows.length === 0) {
        this.logger.warn(`Push via Supabase REST: paper ${paperId} belum ada baris payments di ocs2.`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Gagal push via Supabase REST untuk paper ${paperId}: ${err.message}`);
      return false;
    }
  }

  // Jalur 2 (fallback): endpoint internal CMS-IAPA-BE.
  private async pushViaOcs2InternalApi(paperId: string, totalAmount: number, paymentStatus: string) {
    const baseUrl = process.env.OCS2_API_URL || 'https://cms-iapa-be.up.railway.app/api';
    const secret = process.env.INTERNAL_SYNC_SECRET;
    if (!secret) {
      if (!this.warnedMissingInternalEnv) {
        this.logger.warn('INTERNAL_SYNC_SECRET belum diisi di .env — fallback ke ocs2 di-skip.');
        this.warnedMissingInternalEnv = true;
      }
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/internal/payment-sync/${paperId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
        body: JSON.stringify({ totalAmount, paymentStatus }),
      });
      if (!res.ok) {
        this.logger.warn(`Push payment ke ocs2 (fallback) gagal untuk paper ${paperId}: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err: any) {
      this.logger.error(`Gagal push payment (fallback) untuk paper ${paperId} ke ocs2: ${err.message}`);
    }
  }
}
