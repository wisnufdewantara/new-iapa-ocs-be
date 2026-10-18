-- Grant produksi buat Dashboard Keuangan (/finance) & Statistik (/statistics).
-- JANGAN jalanin prisma/seed-roles.ts di produksi buat ini — seed itu
-- deleteMany + createMany semua grant role sistem (custom grant hilang).
-- File ini idempotent (ON CONFLICT DO NOTHING), aman dijalanin ulang.
-- Cek dulu identitas DB-nya (SELECT current_database();) sebelum dijalanin.

BEGIN;

-- Permission
INSERT INTO sisko.role_permissions (role_id, module, action)
SELECT id, 'report', 'finance_dashboard' FROM sisko.roles WHERE name IN ('Admin', 'Admin_Keuangan')
ON CONFLICT DO NOTHING;

INSERT INTO sisko.role_permissions (role_id, module, action)
SELECT id, 'report', 'statistics' FROM sisko.roles WHERE name IN ('Admin', 'Manager')
ON CONFLICT DO NOTHING;

-- Menu sidebar
INSERT INTO sisko.role_menu_items (role_id, menu_key)
SELECT id, '/finance' FROM sisko.roles WHERE name IN ('Admin', 'Admin_Keuangan')
ON CONFLICT DO NOTHING;

INSERT INTO sisko.role_menu_items (role_id, menu_key)
SELECT id, '/statistics' FROM sisko.roles WHERE name IN ('Admin', 'Manager')
ON CONFLICT DO NOTHING;

COMMIT;
