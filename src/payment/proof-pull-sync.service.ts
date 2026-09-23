import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Arah KEBALIKAN dari Ocs2SyncService (yang newocs -> ocs2). Ini khusus
// bukti transfer, ocs2 -> newocs, karena peserta MASIH DOMINAN upload
// bukti transfer lewat ocs2.iapa.or.id (bukan newocs), dan ocs2 (Java)
// nggak punya jalur push keluar sama sekali — satu-satunya cara newocs
// tau ada bukti baru adalah POLLING Supabase REST API secara berkala.
//
// Ditemukan manual 2026-09-23: 5 bukti transfer yang diupload peserta
// lewat ocs2 nyangkut nggak kelihatan sama sekali di newocs selama
// beberapa hari (admin yang cek dashboard newocs doang bakal ngira
// peserta itu belum bayar, padahal udah).
@Injectable()
export class ProofPullSyncService {
  private readonly logger = new Logger(ProofPullSyncService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('*/15 * * * *')
  async pullNewProofsScheduled() {
    await this.runPull();
  }

  async runPull(): Promise<{ pulled: number; statusUpdated: number }> {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      this.logger.warn('SUPABASE_URL/SUPABASE_SECRET_KEY belum diisi — proof pull sync di-skip.');
      return { pulled: 0, statusUpdated: 0 };
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
        return { pulled: 0, statusUpdated: 0 };
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

      if (pulled > 0) {
        this.logger.log(`Proof pull sync: ${pulled} bukti transfer baru ditarik dari ocs2, ${statusUpdated} status payment diupdate.`);
      }
      return { pulled, statusUpdated };
    } catch (err: any) {
      this.logger.error(`Proof pull sync gagal: ${err.message}`);
      return { pulled: 0, statusUpdated: 0 };
    }
  }
}
