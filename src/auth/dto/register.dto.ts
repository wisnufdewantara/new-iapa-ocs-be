import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

// Field & validasi ini SENGAJA dipersis-samain dengan CreateUserRequestDTO
// di CMS-IAPA-BE (Java) lama, biar registrasi newocs bener-bener niru
// ocs2 — termasuk batas panjang field & field repeatPassword.
export class RegisterDto {
  @IsString()
  @MaxLength(50)
  username: string;

  @IsString()
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  repeatPassword: string;

  @IsIn(['Male', 'Female'])
  gender: 'Male' | 'Female';

  @IsString()
  @MaxLength(100)
  affiliation: string;

  @IsEmail()
  @MaxLength(100)
  email: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsString()
  @MaxLength(50)
  country: string;
}
