import { IsString, MinLength } from 'class-validator';

export class VerifyAdminGateDto {
  @IsString()
  @MinLength(1)
  password: string;
}
