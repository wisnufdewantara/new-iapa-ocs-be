import { IsBoolean, IsNumber, Min } from 'class-validator';

export class OverrideParticipantDto {
  @IsBoolean()
  isMember: boolean;

  @IsNumber()
  @Min(0)
  totalAmount: number;
}
