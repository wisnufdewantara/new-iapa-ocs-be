import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @IsNotEmpty()
  role: string;
}
