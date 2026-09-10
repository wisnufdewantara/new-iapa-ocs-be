import { IsOptional, IsUUID } from 'class-validator';

export class UpdateConferenceAwardsDto {
  @IsOptional()
  @IsUUID()
  bestPaperId?: string;

  @IsOptional()
  @IsUUID()
  bestPresenterId?: string;
}
