#!/usr/bin/env bash
# Buka tunnel SSH ke Postgres server Dewaweb, biar bisa dipakai tool
# lokal (psql, DBeaver, dll) connect ke 127.0.0.1:5433 seolah-olah
# langsung ke database production/staging di sana.
#
# Pemakaian: ./tunnel-db.sh
# Biarkan jalan di terminal (foreground) selama masih butuh koneksi,
# Ctrl+C buat berhenti. Kalau putus sendiri (kadang kejadian), tinggal
# jalanin ulang.
ssh -N -L 5433:127.0.0.1:5432 sgl14.dewaweb.com
