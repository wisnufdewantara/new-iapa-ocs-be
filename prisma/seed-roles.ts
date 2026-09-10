// Jalan manual sekali: npx ts-node prisma/seed-roles.ts
// Insert 6 role sistem + menu bawaan (DEFAULT_ROLE_MENU, direkonstruksi
// dari config/menu.ts FE) + permission bawaan (DEFAULT_ROLE_PERMISSIONS,
// sama persis dengan otorisasi @Roles() sebelum PermissionsGuard
// dibangun) — lihat src/roles/menu-items.constant.ts &
// permission-catalog.constant.ts.
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLE_MENU } from '../src/roles/menu-items.constant';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/roles/permission-catalog.constant';

const prisma = new PrismaClient();

async function main() {
  for (const [name, menuKeys] of Object.entries(DEFAULT_ROLE_MENU)) {
    const role = await prisma.roles.upsert({
      where: { name },
      create: { name, is_system: true },
      update: { is_system: true },
    });
    await prisma.role_menu_items.deleteMany({ where: { role_id: role.id } });
    await prisma.role_menu_items.createMany({
      data: menuKeys.map((menu_key) => ({ role_id: role.id, menu_key })),
    });
    console.log(`Seeded role ${name} dengan ${menuKeys.length} menu item`);

    const permissions = DEFAULT_ROLE_PERMISSIONS[name] ?? [];
    await prisma.role_permissions.deleteMany({ where: { role_id: role.id } });
    await prisma.role_permissions.createMany({
      data: permissions.map(({ module, action }) => ({ role_id: role.id, module, action })),
    });
    console.log(`Seeded role ${name} dengan ${permissions.length} permission`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
