import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { CONFERENCE_STATUSES, ConferenceStatus } from '../conference-status';

export class UpdateConferenceDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  conferenceName?: string;

  @IsOptional()
  @IsDateString()
  conferenceDate?: string;

  @IsOptional()
  @IsDateString()
  conferenceEndDate?: string;

  @IsOptional()
  @IsIn(CONFERENCE_STATUSES)
  status?: ConferenceStatus;
}
