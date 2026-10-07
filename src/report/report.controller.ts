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
import { PAPERS_COLUMNS, PARTICIPANTS_COLUMNS, PAYMENTS_COLUMNS, ReportColumn, resolveColumns } from './report-columns.constant';
import { buildCsv, buildXlsx } from './report-file.util';

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

  // Daftar kolom per jenis laporan — dipakai FE buat render checklist
  // kolom (bukan hardcode duplikat label di 2 tempat).
  @Get('columns')
  @RequirePermission('report', 'download')
  getColumns() {
    return {
      papers: PAPERS_COLUMNS,
      payments: PAYMENTS_COLUMNS,
      participants: PARTICIPANTS_COLUMNS,
    };
  }

  private async sendReport(
    res: any,
    rows: Record<string, unknown>[],
    columns: ReportColumn[],
    format: string | undefined,
    filenameBase: string,
    sheetName: string,
  ) {
    if (format === 'xlsx') {
      const buffer = await buildXlsx(rows, columns, sheetName);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      res.send(buffer);
    } else {
      const csv = buildCsv(rows, columns);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
    }
  }

  @Get('papers/csv')
  @RequirePermission('report', 'download')
  async downloadPapers(
    @Query('conferenceId') conferenceId: string | undefined,
    @Query('columns') columnsParam: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const rows = await this.reportService.getPapersRows(conferenceId);
    const columns = resolveColumns(PAPERS_COLUMNS, columnsParam);
    const filenameBase = conferenceId ? `papers-${conferenceId}` : 'papers-all';
    await this.sendReport(res, rows, columns, format, filenameBase, 'Papers');
  }

  @Get('payments/csv')
  @RequirePermission('report', 'download')
  async downloadPayments(
    @Query('conferenceId') conferenceId: string | undefined,
    @Query('columns') columnsParam: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const rows = await this.reportService.getPaymentsRows(conferenceId);
    const columns = resolveColumns(PAYMENTS_COLUMNS, columnsParam);
    const filenameBase = conferenceId ? `payments-${conferenceId}` : 'payments-all';
    await this.sendReport(res, rows, columns, format, filenameBase, 'Payments');
  }

  @Get('participants/csv')
  @RequirePermission('report', 'download')
  async downloadParticipants(
    @Query('conferenceId') conferenceId: string | undefined,
    @Query('columns') columnsParam: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: any,
  ) {
    assertValidConferenceId(conferenceId);
    const rows = await this.reportService.getParticipantsRows(conferenceId);
    const columns = resolveColumns(PARTICIPANTS_COLUMNS, columnsParam);
    const filenameBase = conferenceId ? `participants-${conferenceId}` : 'participants-all';
    await this.sendReport(res, rows, columns, format, filenameBase, 'Participants');
  }
}
