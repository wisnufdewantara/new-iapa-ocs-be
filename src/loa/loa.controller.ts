import { Body, Controller, ForbiddenException, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { LoaService } from './loa.service';

@Controller('api/loa')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoaController {
  constructor(private loaService: LoaService) {}

  // Self-service: presenter download LOA milik sendiri
  // Tidak butuh permission 'loa.manage', hanya perlu JWT valid.
  // Paper harus sudah conference_status = 'Accepted'.
  @Get('mine/download')
  @Header('Content-Type', 'application/pdf')
  async downloadMine(@Req() req: any, @Res() res: Response) {
    const userId = (req.user as { userId: string }).userId;
    const paper = await this.loaService.findMyAcceptedPaper(userId);
    if (!paper) throw new ForbiddenException('Paper kamu belum diterima atau belum ada.');
    const pdf = await this.loaService.generatePdf(paper.paperId);
    res.setHeader('Content-Disposition', `attachment; filename="LoA-${paper.paperId}.pdf"`);
    res.send(pdf);
  }

  @Get()
  @RequirePermission('loa', 'manage')
  findByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.loaService.findByConference(conferenceId);
  }

  @Get(':paperId/download')
  @RequirePermission('loa', 'manage')
  @Header('Content-Type', 'application/pdf')
  async download(@Param('paperId', ParseUUIDPipe) paperId: string, @Res() res: Response) {
    const pdf = await this.loaService.generatePdf(paperId);
    res.setHeader('Content-Disposition', `attachment; filename="LoA-${paperId}.pdf"`);
    res.send(pdf);
  }

  @Post(':paperId/send')
  @RequirePermission('loa', 'manage')
  send(@Param('paperId', ParseUUIDPipe) paperId: string) {
    return this.loaService.send(paperId);
  }

  @Post('send-bulk')
  @RequirePermission('loa', 'manage')
  sendBulk(@Body('paperIds') paperIds: string[]) {
    return this.loaService.sendBulk(paperIds);
  }
}
