import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { AttendanceService } from './attendance.service';
import { ToggleParticipantAttendanceDto, ToggleTeamAttendanceDto } from './dto/toggle-attendance.dto';

// /api/attendance/** -> butuh izin attendance:manage.
@Controller('api/attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('attendance', 'manage')
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
