import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.users.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('Username atau password salah');

    // Password lama diverifikasi dengan bcrypt, sama seperti BCryptPasswordEncoder
    // di backend Java, jadi akun hasil migrasi tetap bisa login tanpa reset.
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Username atau password salah');

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
