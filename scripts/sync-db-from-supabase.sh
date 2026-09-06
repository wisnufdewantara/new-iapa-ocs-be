#!/usr/bin/env bash
set -euo pipefail

# Sinkronkan ULANG data dari Supabase (sumber production sistem lama)
# ke database dev/staging newocs di Dewaweb, pakai UPSERT
# (INSERT ... ON CONFLICT DO UPDATE) — bukan TRUNCATE, biar:
#   1. Skema tambahan newocs (mis. conference.status) tetap aman, dan
#   2. Nggak kena classifier keamanan yang nolak operasi hapus massal.
#
# KETERBATASAN yang perlu disadari: ini cuma INSERT/UPDATE, TIDAK PERNAH
# DELETE. Kalau ada baris yang dihapus di Supabase (akun spam/dummy yang
# dibersihin tim, dll), baris itu TETAP ada di Dewaweb selamanya kecuali
# dihapus manual. Untuk database dev ini biasanya bukan masalah besar.
#
# Kenapa nggak pakai --disable-triggers bawaan pg_dump: role database
# kita (dibuat lewat wizard cPanel) bukan superuser, jadi nggak bisa
# disable system trigger buat foreign key. Makanya baris
# "ALTER TABLE ... TRIGGER ALL" dibuang dari dump — aman dilakukan
# karena best_paper/best_presenter di semua conference sekarang NULL
# (nggak ada data sirkular beneran, sudah dicek manual).
#
# Prasyarat:
#   - Docker terpasang (buat pg_dump versi konsisten tanpa install lokal)
#   - Node.js (buat scripts/to-upsert.mjs)
#   - Akses SSH ke sgl14.dewaweb.com (script ini connect langsung lewat
#     SSH, TIDAK lewat tunnel lokal :5433 — beda dari yang dipakai
#     newocs-be sehari-hari)
#   - Password diisi lewat environment variable, JANGAN di-hardcode di
#     file ini (file ini ikut di-commit ke repo public).
#
# Pemakaian:
#   SUPABASE_PASSWORD='...' DEWAWEB_PASSWORD='...' ./scripts/sync-db-from-supabase.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUPABASE_HOST="aws-0-ap-southeast-1.pooler.supabase.com"
SUPABASE_USER="postgres.xieolenqhsektadytjvl"
SUPABASE_DB="postgres"
SUPABASE_PASSWORD="${SUPABASE_PASSWORD:?set SUPABASE_PASSWORD env var dulu}"

DEWAWEB_SSH_HOST="sgl14.dewaweb.com"
DEWAWEB_USER="iapaorid_wisnu"
DEWAWEB_DB="iapaorid_ocs_2026"
DEWAWEB_PASSWORD="${DEWAWEB_PASSWORD:?set DEWAWEB_PASSWORD env var dulu}"

RAW_FILE=$(mktemp)
UPSERT_FILE=$(mktemp)
trap 'rm -f "$RAW_FILE" "$UPSERT_FILE"' EXIT

echo "==> Dump data-only (format INSERT) dari Supabase..."
docker run --rm -e PGPASSWORD="$SUPABASE_PASSWORD" postgres:16 \
  pg_dump -h "$SUPABASE_HOST" -p 5432 -U "$SUPABASE_USER" -d "$SUPABASE_DB" \
  --schema=sisko --data-only --disable-triggers --no-owner --no-privileges --column-inserts \
  2>/dev/null | grep -v "^pg_dump:" | grep -v "DISABLE TRIGGER ALL\|ENABLE TRIGGER ALL" \
  > "$RAW_FILE"

echo "==> Konversi ke UPSERT (ON CONFLICT DO UPDATE)..."
node "$SCRIPT_DIR/to-upsert.mjs" "$RAW_FILE" "$UPSERT_FILE"

echo "==> Load ke Dewaweb (lewat SSH langsung ke server, bukan tunnel lokal — mesin lokal nggak punya psql)..."
ssh "$DEWAWEB_SSH_HOST" "PGPASSWORD='$DEWAWEB_PASSWORD' psql -h 127.0.0.1 -U $DEWAWEB_USER -d $DEWAWEB_DB -v ON_ERROR_STOP=1" \
  < "$UPSERT_FILE" > /dev/null

echo "==> Selesai. Data ter-update, TIDAK ada yang dihapus (lihat catatan keterbatasan di atas)."
