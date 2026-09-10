import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';
import { PERMISSION_CATALOG } from './permission-catalog.constant';

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  findAll() {
    return this.prisma.roles.findMany({ orderBy: { created_at: 'asc' } });
  }

  async create(name: string, actorUserId?: string) {
    const existing = await this.prisma.roles.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) throw new ConflictException('Nama role sudah dipakai');
    const created = await this.prisma.roles.create({ data: { name, is_system: false } });
    await this.auditLog.log(actorUserId, 'create_role', 'roles', created.id, name);
    return created;
  }

  async remove(roleId: string, actorUserId?: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    if (role.is_system) throw new ConflictException('Role sistem tidak bisa dihapus');
    const stillUsed = await this.prisma.users.findFirst({ where: { role: role.name } });
    if (stillUsed) throw new ConflictException('Masih ada user dengan role ini, ganti dulu role mereka');
    await this.prisma.roles.delete({ where: { id: roleId } });
    await this.auditLog.log(actorUserId, 'delete_role', 'roles', roleId, role.name);
    return { deleted: true };
  }

  async menuItems(roleId: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    const rows = await this.prisma.role_menu_items.findMany({ where: { role_id: roleId } });
    return rows.map((r) => r.menu_key);
  }

  async setMenuItems(roleId: string, menuKeys: string[], actorUserId?: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    await this.prisma.$transaction([
      this.prisma.role_menu_items.deleteMany({ where: { role_id: roleId } }),
      this.prisma.role_menu_items.createMany({
        data: menuKeys.map((menu_key) => ({ role_id: roleId, menu_key })),
      }),
    ]);
    await this.auditLog.log(actorUserId, 'update_role_menu', 'roles', roleId, menuKeys.join(','));
    return { menuKeys };
  }

  async menuForRoleName(roleName: string) {
    const role = await this.prisma.roles.findUnique({ where: { name: roleName } });
    if (!role) return [];
    const rows = await this.prisma.role_menu_items.findMany({ where: { role_id: role.id } });
    return rows.map((r) => r.menu_key);
  }

  async permissions(roleId: string) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    const rows = await this.prisma.role_permissions.findMany({ where: { role_id: roleId } });
    return rows.map((r) => ({ module: r.module, action: r.action }));
  }

  async setPermissions(
    roleId: string,
    permissions: { module: string; action: string }[],
    actorUserId?: string,
  ) {
    const role = await this.prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role tidak ditemukan');
    for (const { module, action } of permissions) {
      if (!PERMISSION_CATALOG[module]?.includes(action)) {
        throw new BadRequestException(`Permission tidak dikenal: ${module}:${action}`);
      }
    }
    await this.prisma.$transaction([
      this.prisma.role_permissions.deleteMany({ where: { role_id: roleId } }),
      this.prisma.role_permissions.createMany({
        data: permissions.map(({ module, action }) => ({ role_id: roleId, module, action })),
      }),
    ]);
    await this.auditLog.log(
      actorUserId,
      'update_role_permissions',
      'roles',
      roleId,
      permissions.map((p) => `${p.module}:${p.action}`).join(','),
    );
    return { permissions };
  }
}
