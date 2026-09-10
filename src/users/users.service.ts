import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    const users = await this.prisma.users.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        user_id: true,
        username: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        affiliation: true,
        created_at: true,
      },
    });
    return users.map((u) => ({
      userId: u.user_id,
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role,
      affiliation: u.affiliation,
      createdAt: u.created_at,
    }));
  }

  async updateRole(userId: string, role: string, actorUserId?: string) {
    const user = await this.prisma.users.findUnique({ where: { user_id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const roleExists = await this.prisma.roles.findUnique({ where: { name: role } });
    if (!roleExists) throw new NotFoundException(`Role "${role}" tidak ditemukan`);

    const updated = await this.prisma.users.update({
      where: { user_id: userId },
      data: { role },
    });
    await this.auditLog.log(actorUserId, 'update_user_role', 'users', userId, role);
    return { userId: updated.user_id, role: updated.role };
  }
}
