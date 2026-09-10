// Jalan manual sekali (SETELAH seed-roles.ts, dan HANYA di database
// staging): DATABASE_URL="...staging..." STAGING_ADMIN_PASSWORD="..." npx ts-node prisma/seed-staging-demo.ts
//
// Isi data demo aman buat coba-coba di staging: akun admin baru (password
// KHUSUS staging, beda dari production — WAJIB dikasih lewat env var
// STAGING_ADMIN_PASSWORD, TIDAK ditulis plaintext di file ini — lihat
// SESSION_NOTES.md/riwayat chat buat nilainya), payment_types builtin,
// dan 1 conference demo. Guard di bawah nolak jalan kalau DATABASE_URL
// yang aktif bukan staging, biar nggak kepencet nyeed database production.
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl.includes('_staging')) {
  console.error('DATABASE_URL aktif bukan database staging. Batalkan — script ini cuma boleh jalan ke database staging.');
  process.exit(1);
}

const STAGING_ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD ?? '';
if (!STAGING_ADMIN_PASSWORD) {
  console.error('STAGING_ADMIN_PASSWORD belum diisi. Batalkan — password nggak boleh di-hardcode di file ini.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash(STAGING_ADMIN_PASSWORD, 10);
  await prisma.users.upsert({
    where: { username: 'staging_admin' },
    create: {
      username: 'staging_admin',
      password: hashedPassword,
      hash_algorithm: 'bcrypt',
      first_name: 'Staging',
      last_name: 'Admin',
      gender: 'Male',
      affiliation: 'newocs staging',
      email: 'staging.admin@example.com',
      phone: '0800000000',
      country: 'Indonesia',
      role: 'Admin',
    },
    update: {},
  });
  console.log('Seeded staging_admin (role Admin)');

  await prisma.payment_types.upsert({
    where: { type_key: 'presenter' },
    create: { payment_type_id: crypto.randomUUID(), builtin: true, label: 'Presenter', type_key: 'presenter', unique_code: '01' },
    update: {},
  });
  await prisma.payment_types.upsert({
    where: { type_key: 'participant' },
    create: { payment_type_id: crypto.randomUUID(), builtin: true, label: 'Participant', type_key: 'participant', unique_code: '02' },
    update: {},
  });
  console.log('Seeded payment_types builtin (presenter, participant)');

  const conference = await prisma.conference.upsert({
    where: { conference_name: 'Staging Demo Conference 2026' },
    create: {
      conference_name: 'Staging Demo Conference 2026',
      conference_date: new Date('2026-11-01'),
      conference_end_date: new Date('2026-11-03'),
      status: 'ongoing',
    },
    update: {},
  });
  await prisma.conference_sub_theme.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: { id: '00000000-0000-0000-0000-000000000001', conference_id: conference.conference_id, sub_theme: 'Demo Sub Tema' },
    update: {},
  });
  console.log('Seeded conference demo:', conference.conference_name);

  console.log('\nSelesai. Login staging: username "staging_admin", password lihat SESSION_NOTES.md / riwayat chat.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
