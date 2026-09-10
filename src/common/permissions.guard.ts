import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Ganti RolesGuard (enum hardcode) — sekarang role bebas (bisa custom),
// jadi otorisasi dicek dari tabel role_permissions, bukan cocok-cocokan
// string ke enum statis. Query per-request, tanpa cache — aplikasi kecil,
// query-nya sendiri kena composite unique index.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<{ module: string; action: string } | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.role) return false;

    const grant = await this.prisma.role_permissions.findFirst({
      where: { module: required.module, action: required.action, roles: { name: user.role } },
    });
    return !!grant;
  }
}
