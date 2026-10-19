import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

  // Deskripsi acara di homepage — teks polos (baris baru dipertahankan).
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;
}
