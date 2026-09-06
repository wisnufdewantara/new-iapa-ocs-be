import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

// Sama seperti SettingController Java lama: /api/settings/** -> Admin,
// Admin_Keuangan.
@Controller('api/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Admin_Keuangan)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.settingsService.update(key, dto.value);
  }
}
