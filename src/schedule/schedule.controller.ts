import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';

@Controller('api/schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('schedule', 'manage')
export class ScheduleController {
  constructor(private scheduleService: ScheduleService) {}

  @Get(':conferenceId')
  findByConference(@Param('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.scheduleService.findByConference(conferenceId);
  }

  @Get('papers/:conferenceId')
  eligiblePapers(@Param('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.scheduleService.eligiblePapers(conferenceId);
  }

  @Post(':conferenceId')
  create(@Param('conferenceId', ParseUUIDPipe) conferenceId: string, @Body() dto: CreateScheduleDto) {
    return this.scheduleService.create(conferenceId, dto);
  }
}
