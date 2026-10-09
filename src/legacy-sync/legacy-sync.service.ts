import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'pg';

// Versi "tombol admin" dari scripts/sync-from-supabase.mjs — logikanya
// SAMA PERSIS (UPSERT per tabel, urutan respect FK, nggak pernah DELETE),
// tapi sisi Supabase-nya connect lewat REST API (fetch, HTTPS) bukan raw
// Postgres (`pg` Client) seperti script aslinya. Alasannya: script asli
// WAJIB dijalankan dari laptop + SSH tunnel karena port Postgres pooler
// Supabase diblokir dari jaringan Dewaweb — tapi HTTPS ke REST API-nya
// TIDAK diblokir (dibuktikan oleh ProofPullSyncService yang udah jalan
// otomatis tiap 15 menit lewat jalur yang sama). Sisi Dewaweb-nya connect
// ke Postgres LOKAL (bukan lewat tunnel) karena endpoint ini jalan DI
// SERVER yang sama — makanya bisa dipicu tombol admin tanpa laptop nyala
// sama sekali.
interface TableSpec {
  name: string;
  pk: string;
  excludeColumns?: string[];
  // Kondisi tambahan di ON CONFLICT DO UPDATE — baris lokal yang nggak
  // memenuhi ini dibiarkan (nggak ditimpa data ocs2).
  updateWhere?: string;
}

// SENGAJA TIDAK termasuk app_settings & payment_types — lihat komentar
// yang sama di scripts/sync-from-supabase.mjs.
const TABLES: TableSpec[] = [
  { name: 'users', pk: 'user_id' },
  { name: 'conference', pk: 'conference_id', excludeColumns: ['papers_submission_open'] },
  { name: 'conference_sub_theme', pk: 'id' },
  { name: 'papers', pk: 'paper_id' },
  { name: 'paper_writers', pk: 'writer_id' },
  { name: 'paper_reviewer', pk: 'review_id' },
  { name: 'sessions', pk: 'session_id' },
  { name: 'schedule', pk: 'schedule_id' },
  // Peserta yang daftar ulang ke conference baru (ParticipantService.join)
  // barisnya dipakai ulang — jangan ditimpa balik pakai data conference
  // lamanya dari ocs2.
  {
    name: 'participant',
    pk: 'attendance_id',
    updateWhere: 'participant.conference_id IS NOT DISTINCT FROM EXCLUDED.conference_id',
  },
  { name: 'attendance', pk: 'id' },
  { name: 'payments', pk: 'payment_id' },
  { name: 'payment_proofs', pk: 'proof_id' },
  { name: 'invoices', pk: 'invoice_id' },
];

const BATCH_SIZE = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface TableSyncResult {
  table: string;
  rows: number;
  skipped: { pk: string; reason: string }[];
  error?: string;
}

export interface LegacySyncResult {
  startedAt: string;
  finishedAt: string;
  totalRows: number;
  totalSkipped: number;
  tables: TableSyncResult[];
}

@Injectable()
export class LegacySyncService {
  private readonly logger = new Logger(LegacySyncService.name);
  // Lock in-memory sederhana — cukup buat 1 proses Node ini, nggak
  // perlu file lock kayak script (yang didesain buat cron lintas-proses).
  // Cegah 2 admin nge-klik tombol sync bersamaan, bukan cegah overlap
  // sama cron lain (nggak ada cron lain yang nyentuh tabel-tabel ini).
  private running = false;

  private async fetchSupabaseTable(
    baseUrl: string,
    secretKey: string,
    tableName: string,
  ): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${baseUrl}/rest/v1/${tableName}?select=*&limit=20000`, {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        'Accept-Profile': 'sisko',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} dari Supabase REST`);
    }
    return (await res.json()) as Record<string, unknown>[];
  }

  private async syncTable(
    baseUrl: string,
    secretKey: string,
    dewaweb: Client,
    table: TableSpec,
  ): Promise<TableSyncResult> {
    const rows = await this.fetchSupabaseTable(baseUrl, secretKey, table.name);
    if (rows.length === 0) return { table: table.name, rows: 0, skipped: [] };

    const exclude = new Set(table.excludeColumns ?? []);
    const columns = Object.keys(rows[0]).filter((c) => !exclude.has(c));
    const updateCols = columns.filter((c) => c !== table.pk);
    const conflictClause =
      updateCols.length === 0
        ? `ON CONFLICT (${table.pk}) DO NOTHING`
        : `ON CONFLICT (${table.pk}) DO UPDATE SET ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}${
            table.updateWhere ? ` WHERE ${table.updateWhere}` : ''
          }`;

    const singleSql = (n: number) => {
      const placeholders = columns.map((_, i) => `$${n * columns.length + i + 1}`).join(', ');
      return `(${placeholders})`;
    };
    const buildBatchSql = (n: number) =>
      `INSERT INTO sisko.${table.name} (${columns.join(', ')}) VALUES ${Array.from({ length: n }, (_, i) => singleSql(i)).join(', ')} ${conflictClause}`;
    const singleRowSql = `INSERT INTO sisko.${table.name} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ${conflictClause}`;

    // Jalur cepat: kirim per-batch dulu. Kalau 1 batch gagal (biasanya 1
    // baris bentrok unique constraint — data quality issue lama antara
    // 2 sistem, bukan bug sync-nya), fallback ke satu-satu KHUSUS batch
    // itu, biar baris valid tetap ke-sync dan cuma yang bermasalah yang
    // di-skip & dicatat.
    let synced = 0;
    const skipped: { pk: string; reason: string }[] = [];
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const values = batch.flatMap((row) => columns.map((c) => row[c]));
      try {
        await dewaweb.query(buildBatchSql(batch.length), values);
        synced += batch.length;
      } catch {
        for (const row of batch) {
          try {
            await dewaweb.query(
              singleRowSql,
              columns.map((c) => row[c]),
            );
            synced++;
          } catch (err: any) {
            skipped.push({ pk: String(row[table.pk]), reason: err.message });
          }
        }
      }
    }
    return { table: table.name, rows: synced, skipped };
  }

  async runSync(): Promise<LegacySyncResult> {
    if (this.running) {
      throw new ServiceUnavailableException('Sync sebelumnya masih jalan, tunggu sampai selesai.');
    }

    const baseUrl = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    const databaseUrl = process.env.DATABASE_URL;
    if (!baseUrl || !secretKey) {
      throw new ServiceUnavailableException('SUPABASE_URL/SUPABASE_SECRET_KEY belum diisi di server.');
    }
    if (!databaseUrl) {
      throw new ServiceUnavailableException('DATABASE_URL belum diisi di server.');
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    const dewaweb = new Client({ connectionString: databaseUrl });
    const tables: TableSyncResult[] = [];
    try {
      await dewaweb.connect();
      for (const table of TABLES) {
        try {
          const r = await this.syncTable(baseUrl, secretKey, dewaweb, table);
          tables.push(r);
        } catch (err: any) {
          this.logger.error(`Legacy sync [${table.name}] gagal: ${err.message}`);
          tables.push({ table: table.name, rows: 0, skipped: [], error: err.message });
        }
      }
    } finally {
      await dewaweb.end().catch(() => {});
      this.running = false;
    }

    const totalRows = tables.reduce((sum, r) => sum + r.rows, 0);
    const totalSkipped = tables.reduce((sum, r) => sum + r.skipped.length, 0);
    const result: LegacySyncResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      totalRows,
      totalSkipped,
      tables,
    };
    this.logger.log(
      `Legacy sync selesai. ${totalRows} baris tersinkron, ${totalSkipped} di-skip, ${tables.filter((t) => t.error).length} tabel gagal.`,
    );
    return result;
  }
}
