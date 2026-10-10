import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreateUserDto } from './dto/create-user.dto';

// Menu "Kelola Role" -- butuh izin users:manage, buat lihat semua user & ganti role-nya.
@Controller('api/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('users', 'manage')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  // "Login sebagai" peserta — buat admin bantu/cek tampilan dari sisi
  // peserta. Permission terpisah dari users:manage (override level class).
  @Post(':id/impersonate')
  @RequirePermission('users', 'impersonate')
  impersonate(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const actor = req.user as { userId: string; impersonatorId?: string };
    return this.usersService.impersonate(id, actor.userId, actor.impersonatorId);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(dto, (req.user as { userId: string }).userId);
  }

  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Req() req: any) {
    return this.usersService.updateRole(id, dto.role, (req.user as { userId: string }).userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.usersService.remove(id, (req.user as { userId: string }).userId);
  }
}
