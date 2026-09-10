import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { UsersService } from './users.service';
import { UpdateRoleDto } from './dto/update-role.dto';

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

  @Patch(':id/role')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Req() req: any) {
    return this.usersService.updateRole(id, dto.role, (req.user as { userId: string }).userId);
  }
}
