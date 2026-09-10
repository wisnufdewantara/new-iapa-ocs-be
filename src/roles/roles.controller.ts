import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateMenuItemsDto } from './dto/update-menu-items.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Controller('api/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('roles', 'manage')
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateRoleDto, @Req() req: any) {
    return this.rolesService.create(dto.name, (req.user as { userId: string }).userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.rolesService.remove(id, (req.user as { userId: string }).userId);
  }

  @Get(':id/menu-items')
  menuItems(@Param('id') id: string) {
    return this.rolesService.menuItems(id);
  }

  @Put(':id/menu-items')
  setMenuItems(@Param('id') id: string, @Body() dto: UpdateMenuItemsDto, @Req() req: any) {
    return this.rolesService.setMenuItems(id, dto.menuKeys, (req.user as { userId: string }).userId);
  }

  @Get(':id/permissions')
  permissions(@Param('id') id: string) {
    return this.rolesService.permissions(id);
  }

  @Put(':id/permissions')
  setPermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto, @Req() req: any) {
    return this.rolesService.setPermissions(id, dto.permissions, (req.user as { userId: string }).userId);
  }
}

// Menu yang boleh diakses user yang lagi login, dipakai Sidebar FE.
// Cukup JwtAuthGuard (semua role login boleh baca menunya sendiri).
@Controller('api/menu')
@UseGuards(JwtAuthGuard)
export class MenuController {
  constructor(private rolesService: RolesService) {}

  @Get('mine')
  mine(@Req() req: any) {
    return this.rolesService.menuForRoleName((req.user as { role: string }).role);
  }
}
