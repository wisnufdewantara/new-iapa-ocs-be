import { Equals, IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

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

  // Satu-satunya field yang nggak ada di DTO ocs2 lama — persetujuan S&K
  // (termasuk kebijakan non-refundable) dicek di server juga, bukan cuma
  // checkbox di FE yang bisa dilewati kalau API dipanggil langsung.
  @Equals(true, { message: 'Anda harus menyetujui Syarat dan Ketentuan' })
  acceptTerms: boolean;
}
