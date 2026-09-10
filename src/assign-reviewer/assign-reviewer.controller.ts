import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { AssignReviewerService } from './assign-reviewer.service';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';

// /api/assign-reviewer/** -> butuh izin assign_reviewer:manage.
@Controller('api/assign-reviewer')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('assign_reviewer', 'manage')
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
