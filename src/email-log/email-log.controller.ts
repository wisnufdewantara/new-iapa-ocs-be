import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { EmailLogService } from './email-log.service';

// /api/developer/email-log/** — bagian dari dashboard Developer (admin-only).
// Reuse permission 'developer:view' yang udah ada (lihat
// permission-catalog.constant.ts), bukan permission baru.
@Controller('api/developer/email-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('developer', 'view')
export class EmailLogController {
  constructor(private emailLogService: EmailLogService) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.emailLogService.list({ type, status, q, limit: limit ? Number(limit) : undefined });
  }

  @Get('stats')
  stats() {
    return this.emailLogService.stats();
  }
}
