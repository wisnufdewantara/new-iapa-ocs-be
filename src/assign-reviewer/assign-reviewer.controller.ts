import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { AssignReviewerService } from './assign-reviewer.service';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';

// Sama seperti AssignPaperReviewController Java lama: Manager, Reviewer,
// Admin. (Reviewer cuma perlu buat lihat, aksi assign biasanya
// Manager/Admin, tapi cek dilakukan di UI/menu.ts.)
@Controller('api/assign-reviewer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager)
export class AssignReviewerController {
  constructor(private assignReviewerService: AssignReviewerService) {}

  @Get('reviewers')
  listReviewers() {
    return this.assignReviewerService.listReviewers();
  }

  @Get(':conferenceId')
  listByConference(@Param('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.assignReviewerService.listByConference(conferenceId);
  }

  @Post()
  assign(@Req() req: Request, @Body() dto: AssignReviewerDto) {
    const managerId = (req.user as { userId: string }).userId;
    return this.assignReviewerService.assign(managerId, dto);
  }
}
