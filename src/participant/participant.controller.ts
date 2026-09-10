import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { ParticipantService } from './participant.service';
import { JoinConferenceDto } from './dto/join-conference.dto';

@Controller('api/participants')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('participant', 'join')
export class ParticipantController {
  constructor(private participantService: ParticipantService) {}

  @Get('mine')
  findMine(@Req() req: any) {
    return this.participantService.findMine((req.user as { userId: string }).userId);
  }

  @Post('join')
  join(@Req() req: any, @Body() dto: JoinConferenceDto) {
    return this.participantService.join((req.user as { userId: string }).userId, dto.isMember, dto.conferenceId);
  }
}
