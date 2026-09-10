// Katalog module/action yang valid, dipakai validasi PUT /api/roles/:id/permissions
// dan seed role sistem. Nambah endpoint terproteksi baru? Tambahin entry di sini
// dulu, baru dipakai di @RequirePermission(module, action) pada controllernya.
export const PERMISSION_CATALOG: Record<string, string[]> = {
  schedule: ['manage'],
  conference: ['create', 'update', 'manage_awards'],
  papers: ['review', 'submit'],
  attendance: ['manage'],
  assign_reviewer: ['manage'],
  settings: ['manage'],
  users: ['manage'],
  roles: ['manage'],
  loa: ['manage'],
  certificate: ['manage', 'manage_awards'],
  admin_gate: ['verify'],
  payment: ['submit', 'verify', 'manage_types'],
  participant: ['join'],
  developer: ['view'],
};

function allPermissions(): { module: string; action: string }[] {
  return Object.entries(PERMISSION_CATALOG).flatMap(([module, actions]) =>
    actions.map((action) => ({ module, action })),
  );
}

// Grant default 6 role sistem, dipakai prisma/seed-roles.ts. Isinya sama
// persis dengan otorisasi @Roles() yang ada sebelum guard ini dibangun,
// supaya migrasi ke permission granular nggak ngerusak apa pun yang jalan.
export const DEFAULT_ROLE_PERMISSIONS: Record<string, { module: string; action: string }[]> = {
  Admin: allPermissions(),
  Manager: [
    { module: 'conference', action: 'create' },
    { module: 'conference', action: 'update' },
    { module: 'conference', action: 'manage_awards' },
    { module: 'schedule', action: 'manage' },
    { module: 'papers', action: 'review' },
    { module: 'attendance', action: 'manage' },
    { module: 'assign_reviewer', action: 'manage' },
    { module: 'loa', action: 'manage' },
    { module: 'certificate', action: 'manage' },
    { module: 'certificate', action: 'manage_awards' },
  ],
  Reviewer: [{ module: 'papers', action: 'review' }],
  Peserta: [
    { module: 'papers', action: 'submit' },
    { module: 'payment', action: 'submit' },
    { module: 'participant', action: 'join' },
  ],
  Moderator: [
    { module: 'attendance', action: 'manage' },
    { module: 'certificate', action: 'manage' },
  ],
  Admin_Keuangan: [
    { module: 'settings', action: 'manage' },
    { module: 'payment', action: 'verify' },
    { module: 'payment', action: 'manage_types' },
  ],
};
