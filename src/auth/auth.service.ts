import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async findProfile(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        first_name: true,
        last_name: true,
        email: true,
        gender: true,
        affiliation: true,
        phone: true,
        country: true,
      },
    });
    return user
      ? {
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          gender: user.gender,
          affiliation: user.affiliation,
          phone: user.phone,
          country: user.country,
        }
      : null;
  }

  // Urutan validasi & aturan ini niru persis UserServiceImpl.createUser di
  // CMS-IAPA-BE (Java) lama: cek password match dulu, baru cek username,
  // baru email, dan role SELALU dipaksa "Peserta" apa pun yang dikirim FE
  // (di Java lama field role di request itu ada tapi nggak pernah dipakai).
  async register(dto: RegisterDto) {
    if (dto.password !== dto.repeatPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existingUsername = await this.prisma.users.findUnique({ where: { username: dto.username } });
    if (existingUsername) throw new ConflictException('Username already exists');

    const existingEmail = await this.prisma.users.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new ConflictException('Email already exists');

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.users.create({
      data: {
        username: dto.username,
        first_name: dto.firstName,
        last_name: dto.lastName,
        email: dto.email,
        password: hashedPassword,
        hash_algorithm: 'bcrypt',
        gender: dto.gender,
        affiliation: dto.affiliation,
        phone: dto.phone,
        country: dto.country,
        role: 'Peserta',
      },
    });

    return {
      userId: user.user_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      affiliation: user.affiliation,
      phone: user.phone,
    };
  }

  async login(usernameOrEmail: string, password: string) {
    const user = await this.prisma.users.findFirst({
      where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
    });
    if (!user) throw new UnauthorizedException('Username/email atau password salah');

    // Password lama diverifikasi dengan bcrypt, sama seperti BCryptPasswordEncoder
    // di backend Java, jadi akun hasil migrasi tetap bisa login tanpa reset.
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Username/email atau password salah');

    const payload = {
      sub: user.user_id,
      username: user.username,
      role: user.role,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        userId: user.user_id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
