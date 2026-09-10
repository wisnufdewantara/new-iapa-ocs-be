import { IsBoolean, IsUUID } from 'class-validator';

export class JoinConferenceDto {
  @IsBoolean()
  isMember: boolean;

  @IsUUID()
  conferenceId: string;
}
