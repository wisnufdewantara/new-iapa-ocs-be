import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { AttendanceService } from './attendance.service';
import { ToggleParticipantAttendanceDto, ToggleTeamAttendanceDto } from './dto/toggle-attendance.dto';

// Sama seperti AttendanceController Java lama: /api/attendance/** ->
// Moderator, Manager, Admin.
@Controller('api/attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager, Role.Moderator)
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Get('team/:conferenceId')
  teamByConference(@Param('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.attendanceService.teamByConference(conferenceId);
  }

  @Patch('team/:conferenceId')
  toggleTeam(@Param('conferenceId', ParseUUIDPipe) conferenceId: string, @Body() dto: ToggleTeamAttendanceDto) {
    return this.attendanceService.toggleTeam(conferenceId, dto);
  }

  @Get('participant/:conferenceId')
  participantsByConference(@Param('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.attendanceService.participantsByConference(conferenceId);
  }

  @Patch('participant/:conferenceId')
  toggleParticipant(
    @Param('conferenceId', ParseUUIDPipe) conferenceId: string,
    @Body() dto: ToggleParticipantAttendanceDto,
  ) {
    return this.attendanceService.toggleParticipant(conferenceId, dto);
  }
}
