import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Arah KEBALIKAN dari Ocs2SyncService (yang newocs -> ocs2). Ini khusus
// bukti transfer, ocs2 -> newocs, karena peserta MASIH DOMINAN upload
// bukti transfer lewat ocs2.iapa.or.id (bukan newocs), dan ocs2 (Java)
// nggak punya jalur push keluar sama sekali — satu-satunya cara newocs
// tau ada bukti baru adalah POLLING Supabase REST API secara berkala.
// Connect via REST (HTTPS) BUKAN raw Postgres — port Postgres pooler-nya
// diblokir dari jaringan Dewaweb, tapi HTTPS ke Supabase REST nggak.
//
// Ditemukan manual 2026-09-23: 5 bukti transfer yang diupload peserta
// lewat ocs2 nyangkut nggak kelihatan sama sekali di newocs selama
// beberapa hari (admin yang cek dashboard newocs doang bakal ngira
// peserta itu belum bayar, padahal udah).
//
// Ditemukan manual 2026-10-07: pull di atas CUMA nutup proof TIM/presenter
// (tabel payment_proofs, terpisah dari payments). Proof PESERTA disimpen
// LANGSUNG di kolom participant.link_payment_upload sendiri (bukan tabel
// proof terpisah) — nggak pernah ikut ke-pull sama sekali sampai sekarang,
// cuma nyangkut sampai ada yang jalanin sync-from-supabase.mjs manual dari
// laptop. Ditambahin pull participant di bawah biar konsisten sama proof
// tim (otomatis tiap 15 menit, nggak perlu intervensi manual lagi).
@Injectable()
export class ProofPullSyncService {
  private readonly logger = new Logger(ProofPullSyncService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async pullNewProofsScheduled() {
    await this.runPull();
  }

  async runPull(): Promise<{ pulled: number; statusUpdated: number; participantsPulled: number }> {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      this.logger.warn('SUPABASE_URL/SUPABASE_SECRET_KEY belum diisi — proof pull sync di-skip.');
      return { pulled: 0, statusUpdated: 0, participantsPulled: 0 };
    }

    const headers = {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Accept-Profile': 'sisko',
    };

    try {
      const [proofsRes, paymentsRes] = await Promise.all([
        fetch(`${url}/rest/v1/payment_proofs?select=*&limit=5000`, { headers }),
        fetch(`${url}/rest/v1/payments?select=payment_id,paper_id&limit=5000`, { headers }),
      ]);
      if (!proofsRes.ok || !paymentsRes.ok) {
        this.logger.warn(`Gagal fetch dari Supabase: proofs=HTTP ${proofsRes.status} payments=HTTP ${paymentsRes.status}`);
        return { pulled: 0, statusUpdated: 0, participantsPulled: 0 };
      }
      const supaProofs = (await proofsRes.json()) as {
        proof_id: string;
        payment_id: string;
        writer_id: string | null;
        proof_url: string;
        upload_date: string | null;
        sender_name: string | null;
        transfer_date: string | null;
      }[];
      const supaPayments = (await paymentsRes.json()) as { payment_id: string; paper_id: string }[];
      const paperIdByPaymentId = new Map(supaPayments.map((p) => [p.payment_id, p.paper_id]));

      const existingProofIds = new Set(
        (await this.prisma.payment_proofs.findMany({ select: { proof_id: true } })).map((p) => p.proof_id),
      );
      const existingWriterIds = new Set(
        (await this.prisma.paper_writers.findMany({ select: { writer_id: true } })).map((w) => w.writer_id),
      );

      let pulled = 0;
      const touchedPaperIds = new Set<string>();
      for (const proof of supaProofs) {
        if (existingProofIds.has(proof.proof_id)) continue;
        const paperId = paperIdByPaymentId.get(proof.payment_id);
        if (!paperId) continue;
        const localPayment = await this.prisma.payments.findFirst({ where: { paper_id: paperId } });
        if (!localPayment) continue;

        await this.prisma.payment_proofs.create({
          data: {
            proof_id: proof.proof_id,
            payment_id: localPayment.payment_id,
            // writer_id di Supabase bisa nunjuk ke writer yang belum
            // pernah ke-sync ke newocs — FK bakal gagal kalau dipaksa.
            writer_id: proof.writer_id && existingWriterIds.has(proof.writer_id) ? proof.writer_id : null,
            proof_url: proof.proof_url,
            upload_date: proof.upload_date ? new Date(proof.upload_date) : undefined,
            sender_name: proof.sender_name,
            transfer_date: proof.transfer_date,
          },
        });
        pulled++;
        touchedPaperIds.add(paperId);
      }

      let statusUpdated = 0;
      for (const paperId of touchedPaperIds) {
        // Cuma naikin status dari "waiting for payment" -> "waiting for
        // verification". Kalau status lokal udah lebih maju (verified/
        // rejected), JANGAN ditimpa balik.
        const res = await this.prisma.payments.updateMany({
          where: { paper_id: paperId, payment_status: 'waiting for payment' },
          data: { payment_status: 'waiting for verification' },
        });
        statusUpdated += res.count;
      }

      // Proof peserta — beda struktur dari proof tim: nempel LANGSUNG di
      // kolom participant sendiri (link_payment_upload dkk), bukan tabel
      // proof terpisah. attendance_id = user_id, SAMA persis di kedua
      // sistem (users udah ke-sync lebih dulu), jadi tinggal match 1:1.
      let participantsPulled = 0;
      const participantsRes = await fetch(
        `${url}/rest/v1/participant?select=attendance_id,conference_id,link_payment_upload,payment_sender_name,payment_transfer_date,payment_status&limit=5000`,
        { headers },
      );
      if (!participantsRes.ok) {
        this.logger.warn(`Gagal fetch participant dari Supabase: HTTP ${participantsRes.status}`);
      } else {
        const supaParticipants = (await participantsRes.json()) as {
          attendance_id: string;
          conference_id: string | null;
          link_payment_upload: string | null;
          payment_sender_name: string | null;
          payment_transfer_date: string | null;
          payment_status: string | null;
        }[];

        for (const sp of supaParticipants) {
          if (!sp.link_payment_upload) continue;
          const local = await this.prisma.participant.findUnique({ where: { attendance_id: sp.attendance_id } });
          if (!local) continue;
          // Baris lokal udah dipindah ke conference baru (daftar ulang,
          // lihat ParticipantService.join) — bukti di ocs2 itu punya
          // conference LAMA, jangan ditarik ke pendaftaran yang baru.
          if (local.conference_id !== sp.conference_id) continue;
          // URL proof lokal udah sama (bukan upload baru) ATAU status
          // lokal udah lebih maju dari "waiting for payment" (verified/
          // rejected/waiting for verification) — JANGAN ditimpa balik,
          // pola sama kayak proof tim di atas.
          if (local.link_payment_upload === sp.link_payment_upload) continue;
          if (local.payment_status != null && local.payment_status !== 'waiting for payment') continue;

          await this.prisma.participant.update({
            where: { attendance_id: sp.attendance_id },
            data: {
              link_payment_upload: sp.link_payment_upload,
              payment_sender_name: sp.payment_sender_name,
              payment_transfer_date: sp.payment_transfer_date,
              payment_status: 'waiting for verification',
            },
          });
          participantsPulled++;
        }
      }

      if (pulled > 0 || participantsPulled > 0) {
        this.logger.log(
          `Proof pull sync: ${pulled} bukti tim baru, ${participantsPulled} bukti peserta baru, ${statusUpdated} status payment tim diupdate.`,
        );
      }
      return { pulled, statusUpdated, participantsPulled };
    } catch (err: any) {
      this.logger.error(`Proof pull sync gagal: ${err.message}`);
      return { pulled: 0, statusUpdated: 0, participantsPulled: 0 };
    }
  }
}
