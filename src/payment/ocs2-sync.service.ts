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
    const viaSupabase = await this.pushViaSupabaseRest('payments', paperId, {
      total_amount: totalAmount,
      payment_status: paymentStatus,
    });
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
    await this.pushViaSupabaseRest('payments', paperId, fields);
    // Fallback internal API belum support partial-field update (cuma
    // totalAmount+paymentStatus) — kalau REST API Supabase lagi bermasalah,
    // status-only push ini bakal skip dulu sampai itu diperluas juga.
  }

  async pushSentInvoiceByPaperId(paperId: string, sentInvoice: boolean) {
    await this.pushViaSupabaseRest('payments', paperId, { sent_invoice: sentInvoice });
  }

  // Gap yang ketemu 2026-09-23: pushPaymentTotalByPaperId di atas cuma
  // nyentuh sisko.payments.total_amount — status keanggotaan
  // (member_status) PER WRITER di sisko.paper_writers nggak pernah ikut
  // disync. Akibatnya angka total di ocs2 bisa aja kebetulan match, tapi
  // rincian per-penulis (Member/Non-Member) di ocs2 tetap nunjukkin data
  // lama. Match pakai writer_id (SAMA persis di newocs & ocs2 buat data
  // yang berasal dari sync-from-supabase.mjs — beda dari payment_id yang
  // independen per sistem). Kalau writer_id ini belum ada di ocs2 (baru
  // dibuat di newocs doang), push-nya diam-diam nggak update apa-apa
  // (0 rows) — bukan error, cuma nggak ada yang perlu disamain.
  async pushWriterFields(writerId: string, fields: Record<string, unknown>) {
    await this.pushViaSupabaseRest('paper_writers', writerId, fields, 'writer_id');
  }

  // Writer baru/dihapus lewat fitur "Edit Penulis" di newocs (payment
  // detail page) — di-mirror ke Supabase/ocs2 pakai writer_id YANG SAMA
  // biar konsisten kalau nanti perlu dicocokin lagi (misal push
  // member_status berikutnya). POST/DELETE langsung ke PostgREST, bukan
  // lewat pushViaSupabaseRest (yang didesain buat PATCH/filter-by-id).
  async pushWriterCreate(writer: {
    writerId: string;
    paperId: string;
    firstName: string;
    lastName: string;
    gender: string;
    affiliation: string;
    email: string;
    phoneNumber?: string | null;
    role: string;
    isMember: boolean;
  }) {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) return;
    try {
      const res = await fetch(`${url}/rest/v1/paper_writers`, {
        method: 'POST',
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          'Content-Profile': 'sisko',
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          writer_id: writer.writerId,
          paper_id: writer.paperId,
          first_name: writer.firstName,
          last_name: writer.lastName,
          gender: writer.gender,
          affiliation: writer.affiliation,
          email: writer.email,
          phone_number: writer.phoneNumber ?? null,
          role: writer.role,
          member_status: writer.isMember,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Push writer create ke ocs2 gagal untuk writer ${writer.writerId}: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err: any) {
      this.logger.error(`Gagal push writer create untuk writer ${writer.writerId} ke ocs2: ${err.message}`);
    }
  }

  async pushWriterDelete(writerId: string) {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) return;
    try {
      const res = await fetch(`${url}/rest/v1/paper_writers?writer_id=eq.${writerId}`, {
        method: 'DELETE',
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          'Content-Profile': 'sisko',
        },
      });
      if (!res.ok) {
        this.logger.warn(`Push writer delete ke ocs2 gagal untuk writer ${writerId}: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err: any) {
      this.logger.error(`Gagal push writer delete untuk writer ${writerId} ke ocs2: ${err.message}`);
    }
  }

  // newocs sekarang jadi sumber utama buat keputusan Accept/Reject +
  // catatan reviewer (lihat PapersService.updateStatus) — push ke
  // sisko.papers di Supabase (bukan sisko.payments kayak method di atas),
  // biar peserta yang masih cek status di ocs2.iapa.or.id tetap lihat
  // data yang benar. paper_status ikut dikirim (bukan cuma
  // conference_status) karena keduanya kolom terpisah di ocs2 juga.
  async pushPaperStatusByPaperId(
    paperId: string,
    paperStatus: string,
    conferenceStatus: string,
    reviewFeedback?: string,
  ) {
    const fields: Record<string, unknown> = { paper_status: paperStatus, conference_status: conferenceStatus };
    if (reviewFeedback !== undefined) fields.review_feedback = reviewFeedback;
    const viaSupabase = await this.pushViaSupabaseRest('papers', paperId, fields, 'paper_id');
    if (viaSupabase) return;
    await this.pushPaperViaOcs2InternalApi(paperId, paperStatus, conferenceStatus, reviewFeedback);
  }

  // Jalur 1: Supabase PostgREST langsung. Return true kalau berhasil
  // update minimal 1 baris (biar caller tau nggak perlu fallback lagi).
  // `idColumn` defaultnya 'paper_id' karena tabel payments filter-nya
  // juga pakai kolom itu (payments.paper_id), bukan payments.payment_id
  // (lihat komentar di atas file).
  private async pushViaSupabaseRest(
    table: string,
    paperId: string,
    fields: Record<string, unknown>,
    idColumn = 'paper_id',
  ): Promise<boolean> {
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
      const idFilterColumn = table === 'papers' ? 'paper_id' : idColumn;
      const res = await fetch(`${url}/rest/v1/${table}?${idFilterColumn}=eq.${paperId}`, {
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
        this.logger.warn(
          `Push via Supabase REST gagal untuk ${table} paper ${paperId}: HTTP ${res.status} ${await res.text()}`,
        );
        return false;
      }
      const rows = (await res.json()) as unknown[];
      if (rows.length === 0) {
        this.logger.warn(`Push via Supabase REST: paper ${paperId} belum ada baris ${table} di ocs2.`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Gagal push via Supabase REST (${table}) untuk paper ${paperId}: ${err.message}`);
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

  // Fallback endpoint internal khusus paper status+feedback, pasangan
  // POST /api/internal/paper-sync/{paperId} di CMS-IAPA-BE.
  private async pushPaperViaOcs2InternalApi(
    paperId: string,
    paperStatus: string,
    conferenceStatus: string,
    reviewFeedback?: string,
  ) {
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
      const res = await fetch(`${baseUrl}/internal/paper-sync/${paperId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
        body: JSON.stringify({ paperStatus, conferenceStatus, reviewFeedback }),
      });
      if (!res.ok) {
        this.logger.warn(`Push paper ke ocs2 (fallback) gagal untuk paper ${paperId}: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err: any) {
      this.logger.error(`Gagal push paper (fallback) untuk paper ${paperId} ke ocs2: ${err.message}`);
    }
  }
}
