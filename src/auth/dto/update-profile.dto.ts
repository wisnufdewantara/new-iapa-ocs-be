import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Field yang boleh diedit sendiri oleh user — SENGAJA TIDAK termasuk
// username/email/role: username & email dipakai buat login (ganti
// sendiri berisiko konflik unique/lupa identitas login), role cuma
// admin yang boleh ubah (lihat UsersController.updateRole).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsIn(['Male', 'Female'])
  gender?: 'Male' | 'Female';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  affiliation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  country?: string;
}
