// Katalog menu key (path) sisi backend, cermin manual dari MENU di
// newocs-fe/src/config/menu.ts — backend tidak bisa import kode FE, jadi
// daftar ini WAJIB disamain manual tiap kali menu.ts nambah/hapus item.
export const MENU_KEYS = [
  '/dashboard',
  '/conferences',
  '/schedules',
  '/papers/submit',
  '/papers/review',
  '/papers/assign-reviewer',
  '/papers/loa',
  '/join',
  '/attendance',
  '/certificates',
  '/payment',
  '/payment/manage',
  '/admin/roles',
  '/admin/permissions',
  '/admin/settings',
  '/admin/developer',
  '/guide',
] as const;

// Role default (6 sistem) + menu bawaannya, direkonstruksi dari roles:
// Role[] yang sekarang ada per-item di menu.ts FE. Dipakai sekali oleh
// seed-roles.ts.
export const DEFAULT_ROLE_MENU: Record<string, string[]> = {
  Admin: [
    '/dashboard',
    '/conferences',
    '/schedules',
    '/papers/review',
    '/papers/assign-reviewer',
    '/papers/loa',
    '/attendance',
    '/certificates',
    '/payment/manage',
    '/admin/roles',
    '/admin/permissions',
    '/admin/settings',
    '/admin/developer',
    '/guide',
  ],
  Peserta: ['/dashboard', '/papers/submit', '/join', '/payment', '/guide'],
  Manager: [
    '/dashboard',
    '/conferences',
    '/schedules',
    '/papers/review',
    '/papers/assign-reviewer',
    '/papers/loa',
    '/certificates',
    '/guide',
  ],
  Admin_Keuangan: ['/dashboard', '/payment/manage', '/guide'],
  Reviewer: ['/papers/review', '/guide'],
  Moderator: ['/attendance', '/guide'],
};
