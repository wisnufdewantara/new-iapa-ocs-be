import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { LegacySyncService } from './legacy-sync.service';

@Controller('api/legacy-sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LegacySyncController {
  constructor(private readonly legacySyncService: LegacySyncService) {}

  @Post('run')
  @RequirePermission('developer', 'sync')
  run() {
    return this.legacySyncService.runSync();
  }
}
