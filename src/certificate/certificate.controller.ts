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

  // Sengaja TIDAK di-await: kirim ke banyak penerima sekaligus bisa
  // makan waktu lama dan bikin request timeout (masalah yang sama
  // persis yang bikin sistem lama dipindah ke background, lihat
  // AsyncConfig.java/commit 1ddce13). Response balik langsung sebagai
  // "diproses", FE cukup refresh list buat lihat progress lewat flag
  // sentCertificate per baris yang udah ada di endpoint GET.
  @Post('send-bulk')
  sendBulk(@Body('items') items: { attendanceId: string; type: CertificateType }[]) {
    this.certificateService.sendBulk(items).catch((err) => {
      console.error('sendBulk sertifikat gagal total (di luar per-item try/catch):', err);
    });
    return { queued: true, total: items.length };
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
