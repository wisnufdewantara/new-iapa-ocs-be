import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { ReportService } from './report.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// conferenceId query param ini optional (beda dari route param biasa yang
// bisa divalidasi ParseUUIDPipe), tapi tetap divalidasi manual di sini
// sebelum dipakai di Content-Disposition filename — nilai mentah query
// string jangan pernah langsung masuk header tanpa validasi format.
function assertValidConferenceId(conferenceId?: string): void {
  if (conferenceId !== undefined && !UUID_RE.test(conferenceId)) {
    throw new BadRequestException('conferenceId tidak valid');
  }
}

@Controller('api/report')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('papers/csv')
  @RequirePermission('report', 'download')
  async downloadPapersCsv(
    @Query('conferenceId') conferenceId: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const csv = await this.reportService.exportPapersCsv(conferenceId);
    const filename = conferenceId
      ? `papers-${conferenceId}.csv`
      : 'papers-all.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  }

  @Get('payments/csv')
  @RequirePermission('report', 'download')
  async downloadPaymentsCsv(
    @Query('conferenceId') conferenceId: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const csv = await this.reportService.exportPaymentsCsv(conferenceId);
    const filename = conferenceId
      ? `payments-${conferenceId}.csv`
      : 'payments-all.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  }

  @Get('participants/csv')
  @RequirePermission('report', 'download')
  async downloadParticipantsCsv(
    @Query('conferenceId') conferenceId: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const csv = await this.reportService.exportParticipantsCsv(conferenceId);
    const filename = conferenceId
      ? `participants-${conferenceId}.csv`
      : 'participants-all.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8 compatibility
  }
}
