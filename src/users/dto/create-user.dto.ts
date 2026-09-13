import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

// Field & validasi niru RegisterDto (auth/dto/register.dto.ts), bedanya
// di sini role BEBAS dipilih (dipakai admin lewat Kelola Role), bukan
// dipaksa "Peserta" kayak self-register publik.
export class CreateUserDto {
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

  @IsString()
  role: string;
}
