import { IsBoolean, IsUUID } from 'class-validator';

export class ToggleTeamAttendanceDto {
  @IsUUID()
  writerId: string;

  @IsBoolean()
  present: boolean;
}

export class ToggleParticipantAttendanceDto {
  @IsUUID()
  participantId: string;

  @IsBoolean()
  present: boolean;
}
