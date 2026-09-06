import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateScheduleDto {
  @IsUUID()
  paperId: string;

  @IsDateString()
  scheduleDate: string;

  @IsString()
  @MinLength(1)
  scheduleTime: string; // format "HH:mm"

  @IsOptional()
  @IsString()
  sessionName?: string;

  @IsOptional()
  @IsString()
  room?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
