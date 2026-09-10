import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { DeveloperService } from './developer.service';

// /api/developer/** — dashboard monitoring admin-only. Permission
// 'developer:view' SENGAJA cuma di-grant ke role Admin (lihat
// permission-catalog.constant.ts), bukan role manapun yang lain.
@Controller('api/developer')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('developer', 'view')
export class DeveloperController {
  constructor(private developerService: DeveloperService) {}

  @Get('status')
  status() {
    return this.developerService.status();
  }
}
