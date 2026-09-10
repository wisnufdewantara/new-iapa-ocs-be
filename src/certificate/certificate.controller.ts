import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { CertificateService, CertificateType } from './certificate.service';

// Guard sama seperti AttendanceController: sertifikat ditentukan dari
// data kehadiran yang sama.
@Controller('api/certificates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('certificate', 'manage')
export class CertificateController {
  constructor(private certificateService: CertificateService) {}

  @Get()
  listByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.certificateService.listByConference(conferenceId);
  }

  @Get(':attendanceId/download')
  @Header('Content-Type', 'application/pdf')
  async download(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Query('type') type: CertificateType,
    @Res() res: Response,
  ) {
    const pdf = await this.certificateService.downloadByAttendance(attendanceId, type);
    res.setHeader('Content-Disposition', `attachment; filename="Sertifikat-${attendanceId}.pdf"`);
    res.send(pdf);
  }

  @Post(':attendanceId/send')
  send(@Param('attendanceId', ParseUUIDPipe) attendanceId: string, @Body('type') type: CertificateType) {
    return this.certificateService.send(attendanceId, type);
  }

  @Post('send-bulk')
  sendBulk(@Body('items') items: { attendanceId: string; type: CertificateType }[]) {
    return this.certificateService.sendBulk(items);
  }

  @Post('awards/:conferenceId/:award')
  @RequirePermission('certificate', 'manage_awards')
  sendAward(
    @Param('conferenceId', ParseUUIDPipe) conferenceId: string,
    @Param('award') award: 'best_paper' | 'best_presenter',
  ) {
    return this.certificateService.sendAward(conferenceId, award);
  }
}
