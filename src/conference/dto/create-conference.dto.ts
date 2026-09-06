import { IsArray, IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { CONFERENCE_STATUSES, ConferenceStatus } from '../conference-status';

export class CreateConferenceDto {
  @IsString()
  @MinLength(3)
  conferenceName: string;

  @IsDateString()
  conferenceDate: string;

  @IsOptional()
  @IsDateString()
  conferenceEndDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subThemes?: string[];

  @IsOptional()
  @IsIn(CONFERENCE_STATUSES)
  status?: ConferenceStatus;
}
