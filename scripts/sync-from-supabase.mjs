#!/usr/bin/env node
// Sinkronisasi berkala dari Supabase (sumber production sistem lama /
// "Kila") ke database Dewaweb yang dipakai newocs — dirancang buat
// dijalankan lewat cron LANGSUNG DI SERVER DEWAWEB (bukan dari laptop),
// jadi jalan terus tanpa tergantung laptop nyala.
//
// Beda dari scripts/sync-db-from-supabase.sh (versi lama): script ini
// pure Node.js + `pg`, TIDAK butuh Docker/pg_dump/SSH-piping — connect
// langsung ke kedua database pakai parameterized query (lebih aman dari
// SQL-injection lewat data, dan lebih gampang dijalankan otomatis).
//
// Sama seperti versi lama: UPSERT (INSERT ... ON CONFLICT DO UPDATE),
// TIDAK PERNAH DELETE. Baris yang dihapus di Supabase TETAP ada di
// Dewaweb sampai dihapus manual — untuk database dev ini biasanya bukan
// masalah besar (lihat SESSION_NOTES.md).
//
// Env var yang dibutuhkan (isi di ~/.sync-env di server, JANGAN commit):
//   SUPABASE_HOST, SUPABASE_USER, SUPABASE_PASSWORD, SUPABASE_DB (default: postgres)
//   DEWAWEB_HOST (default: 127.0.0.1), DEWAWEB_USER, DEWAWEB_PASSWORD, DEWAWEB_DB
//
// Pemakaian: node scripts/sync-from-supabase.mjs

import { Client } from 'pg';
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// Urutan HARUS menghormati foreign key (parent sebelum child) — lihat
// prisma/schema.prisma buat referensi lengkap. best_paper/best_presenter
// di tabel conference selalu NULL di data production sekarang, jadi
// nggak ada masalah circular reference dalam praktiknya.
//
// SENGAJA TIDAK termasuk app_settings & payment_types: keduanya tabel
// KONFIGURASI yang newocs kelola sendiri lewat menu Settings-nya
// sendiri (independen dari sistem lama) — ke-tes langsung bentrok
// (unique constraint type_key) pas sync pertama, tandanya dua sistem
// itu udah punya seed data sendiri-sendiri. Ikut-sync data peserta/paper
// dari Supabase itu yang dimaksud "priority Kila", bukan config newocs.
const TABLES = [
  { name: 'users', pk: 'user_id' },
  { name: 'conference', pk: 'conference_id' },
  { name: 'conference_sub_theme', pk: 'id' },
  { name: 'papers', pk: 'paper_id' },
  { name: 'paper_writers', pk: 'writer_id' },
  { name: 'paper_reviewer', pk: 'review_id' },
  { name: 'sessions', pk: 'session_id' },
  { name: 'schedule', pk: 'schedule_id' },
  { name: 'participant', pk: 'attendance_id' },
  { name: 'attendance', pk: 'id' },
  { name: 'payments', pk: 'payment_id' },
  { name: 'payment_proofs', pk: 'proof_id' },
  { name: 'invoices', pk: 'invoice_id' },
];

const LOCK_DIR = new URL('.', import.meta.url).pathname;
const LOCK_FILE = join(LOCK_DIR, '.sync.lock');

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const ageMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
    // Kalau lock lebih tua dari 10 menit, anggap proses sebelumnya
    // crash/macet — lepas paksa biar nggak stuck permanen.
    if (ageMs < 10 * 60 * 1000) {
      console.log('Sync sebelumnya masih jalan (lock < 10 menit), skip run ini.');
      process.exit(0);
    }
    console.log('Lock lama ditemukan (>10 menit), dianggap stale, dilepas.');
  }
  if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // sudah kehapus / nggak ada, aman diabaikan
  }
}

function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Env var ${name} wajib diisi`);
  }
  return v;
}

const BATCH_SIZE = 200;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncTable(supabase, dewaweb, table) {
  const { rows } = await supabase.query(`SELECT * FROM sisko.${table.name}`);
  if (rows.length === 0) return { table: table.name, rows: 0, skipped: [] };

  const columns = Object.keys(rows[0]);
  const updateCols = columns.filter((c) => c !== table.pk);
  const conflictClause =
    updateCols.length === 0
      ? `ON CONFLICT (${table.pk}) DO NOTHING`
      : `ON CONFLICT (${table.pk}) DO UPDATE SET ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;

  const singleSql = (n) => {
    const placeholders = columns.map((_, i) => `$${n * columns.length + i + 1}`).join(', ');
    return `(${placeholders})`;
  };
  const buildBatchSql = (n) =>
    `INSERT INTO sisko.${table.name} (${columns.join(', ')}) VALUES ${Array.from({ length: n }, (_, i) => singleSql(i)).join(', ')} ${conflictClause}`;
  const singleRowSql = `INSERT INTO sisko.${table.name} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ${conflictClause}`;

  // Jalur cepat: kirim per-batch (BATCH_SIZE baris sekaligus) biar nggak
  // ribuan round-trip satu-satu — penting buat cron tiap 5 menit. Kalau
  // satu batch gagal (misal ada 1 baris bentrok unique constraint —
  // data quality issue lama antara dua sistem, bukan bug sync), baru
  // fallback ke jalur lambat (satu-satu) KHUSUS buat batch itu, biar
  // baris yang valid tetap ke-sync dan cuma baris bermasalah yang
  // di-skip & dicatat — job otomatis tanpa pengawasan harus tahan
  // terhadap baris bermasalah, bukan berhenti total.
  let synced = 0;
  const skipped = [];
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const values = batch.flatMap((row) => columns.map((c) => row[c]));
    try {
      await dewaweb.query(buildBatchSql(batch.length), values);
      synced += batch.length;
    } catch {
      for (const row of batch) {
        try {
          await dewaweb.query(singleRowSql, columns.map((c) => row[c]));
          synced++;
        } catch (err) {
          skipped.push({ pk: row[table.pk], reason: err.message });
        }
      }
    }
  }
  return { table: table.name, rows: synced, skipped };
}

async function main() {
  acquireLock();
  const supabase = new Client({
    host: env('SUPABASE_HOST'),
    port: 5432,
    database: env('SUPABASE_DB', 'postgres'),
    user: env('SUPABASE_USER'),
    password: env('SUPABASE_PASSWORD'),
    ssl: { rejectUnauthorized: false },
  });
  const dewaweb = new Client({
    host: env('DEWAWEB_HOST', '127.0.0.1'),
    port: Number(env('DEWAWEB_PORT', '5432')),
    database: env('DEWAWEB_DB'),
    user: env('DEWAWEB_USER'),
    password: env('DEWAWEB_PASSWORD'),
  });

  try {
    await supabase.connect();
    await dewaweb.connect();

    const startedAt = new Date().toISOString();
    const results = [];
    for (const table of TABLES) {
      try {
        const r = await syncTable(supabase, dewaweb, table);
        console.log(`  [${table.name}] ${r.rows} baris tersinkron${r.skipped.length ? `, ${r.skipped.length} di-skip` : ''}`);
        results.push(r);
      } catch (err) {
        console.error(`[${table.name}] GAGAL: ${err.message}`);
        results.push({ table: table.name, error: err.message });
      }
    }
    const totalRows = results.reduce((sum, r) => sum + (r.rows ?? 0), 0);
    const failedTables = results.filter((r) => r.error);
    const totalSkipped = results.reduce((sum, r) => sum + (r.skipped?.length ?? 0), 0);
    console.log(
      `[${startedAt}] Sync selesai. Total baris tersinkron: ${totalRows}.` +
        (totalSkipped ? ` ${totalSkipped} baris di-skip (konflik data, lihat detail di bawah).` : '') +
        (failedTables.length ? ` Tabel GAGAL total: ${failedTables.map((f) => f.table).join(', ')}` : ''),
    );
    for (const r of results) {
      if (r.skipped?.length) {
        console.log(`  [${r.table}] skip ${r.skipped.length} baris:`);
        r.skipped.forEach((s) => console.log(`    - pk=${s.pk}: ${s.reason}`));
      }
    }
  } finally {
    await supabase.end().catch(() => {});
    await dewaweb.end().catch(() => {});
    releaseLock();
  }
}

main().catch((err) => {
  console.error('Sync gagal total:', err);
  releaseLock();
  process.exit(1);
});
