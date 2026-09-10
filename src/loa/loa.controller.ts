import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { LoaService } from './loa.service';

@Controller('api/loa')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('loa', 'manage')
export class LoaController {
  constructor(private loaService: LoaService) {}

  @Get()
  findByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.loaService.findByConference(conferenceId);
  }

  @Get(':paperId/download')
  @Header('Content-Type', 'application/pdf')
  async download(@Param('paperId', ParseUUIDPipe) paperId: string, @Res() res: Response) {
    const pdf = await this.loaService.generatePdf(paperId);
    res.setHeader('Content-Disposition', `attachment; filename="LoA-${paperId}.pdf"`);
    res.send(pdf);
  }

  @Post(':paperId/send')
  send(@Param('paperId', ParseUUIDPipe) paperId: string) {
    return this.loaService.send(paperId);
  }

  @Post('send-bulk')
  sendBulk(@Body('paperIds') paperIds: string[]) {
    return this.loaService.sendBulk(paperIds);
  }
}
