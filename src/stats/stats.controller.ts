import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { StatsService } from './stats.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// conferenceId optional (kosong = semua conference), tapi kalau diisi
// tetap divalidasi formatnya — sama kayak report.controller.ts.
function assertValidConferenceId(conferenceId?: string): void {
  if (conferenceId !== undefined && !UUID_RE.test(conferenceId)) {
    throw new BadRequestException('conferenceId tidak valid');
  }
}

@Controller('api/stats')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // Dashboard Keuangan — ada nama/email/HP penagihan, jadi permission-nya
  // dipisah dari statistik umum.
  @Get('finance')
  @RequirePermission('report', 'finance_dashboard')
  finance(@Query('conferenceId') conferenceId: string | undefined) {
    assertValidConferenceId(conferenceId);
    return this.stats.finance(conferenceId);
  }

  @Get('overview')
  @RequirePermission('report', 'statistics')
  overview(@Query('conferenceId') conferenceId: string | undefined) {
    assertValidConferenceId(conferenceId);
    return this.stats.overview(conferenceId);
  }

  // Tanpa @RequirePermission (guard loloskan semua user login) — isinya
  // difilter per permission role pemanggil di service, dan cuma angka.
  @Get('summary')
  summary(@Req() req: any) {
    return this.stats.summary((req.user as { role?: string }).role);
  }
}
