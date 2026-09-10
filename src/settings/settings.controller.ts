import { Body, Controller, Get, Param, Put, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';

// /api/settings/** sekarang murni System Settings (level infrastruktur
// aplikasi) — setting per-conference (mis. tenggat pembayaran) pindah ke
// /api/conferences/:id/settings, lihat ConferenceController.
@Controller('api/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('settings', 'manage')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @Req() req: any) {
    return this.settingsService.update(key, dto.value, (req.user as { userId: string }).userId);
  }

  @Get('system-info')
  systemInfo() {
    return this.settingsService.systemInfo();
  }

  @Post('test-smtp')
  testSmtp(@Req() req: any) {
    return this.settingsService.testSmtp((req.user as { userId: string }).userId);
  }

  @Get('audit-log')
  auditLog(@Query('limit') limit?: string) {
    return this.settingsService.auditLogRecent(limit ? Number(limit) : 200);
  }
}
