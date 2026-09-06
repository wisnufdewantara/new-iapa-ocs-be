import { IsString } from 'class-validator';

export class UpdateSettingDto {
  @IsString()
  value: string;
}
