import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { EmailTemplateService } from '../email-template/email-template.service';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 jam

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mailer: MailerService,
    private emailTemplate: EmailTemplateService,
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

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.prisma.users.update({
      where: { user_id: userId },
      data: {
        first_name: dto.firstName,
        last_name: dto.lastName,
        gender: dto.gender,
        affiliation: dto.affiliation,
        phone: dto.phone,
        country: dto.country,
      },
    });
    return this.findProfile(updated.user_id);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.users.findUnique({ where: { user_id: userId } });
    if (!user) throw new BadRequestException('User tidak ditemukan');

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new UnauthorizedException('Password saat ini salah');

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.users.update({
      where: { user_id: userId },
      data: { password: hashedPassword, hash_algorithm: 'bcrypt' },
    });
    return { changed: true };
  }

  // SENGAJA selalu balikin pesan generik yang sama baik akunnya ketemu
  // maupun nggak — biar orang luar nggak bisa dipakai buat nebak-nebak
  // email/username mana yang terdaftar (user enumeration).
  async forgotPassword(usernameOrEmail: string) {
    const genericResult = { sent: true };
    const user = await this.prisma.users.findFirst({
      where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] },
    });
    if (!user) return genericResult;

    const token = randomBytes(32).toString('hex');
    await this.prisma.password_reset_tokens.create({
      data: {
        token,
        user_id: user.user_id,
        expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetLink = `${process.env.FRONTEND_URL || 'https://dev-ocs.iapa.or.id'}/reset-password?token=${token}`;
    const { subject, bodyHtml } = await this.emailTemplate.render('password_reset', {
      firstName: user.first_name,
      resetLink,
    });
    try {
      await this.mailer.sendMail(user.email, subject, bodyHtml, undefined, { type: 'password_reset', relatedId: user.user_id });
    } catch (err: any) {
      // Jangan biarin kegagalan kirim email (mis. SMTP belum
      // dikonfigurasi) balik jadi 500 ke client — itu bakal jadi celah
      // enumeration (akun ada = error, akun nggak ada = sukses). Log di
      // server aja buat ops, tetap balikin respons generik yang sama.
      this.logger.error(`Gagal kirim email reset password ke ${user.email}: ${err.message}`);
    }
    return genericResult;
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await this.prisma.password_reset_tokens.findUnique({ where: { token } });
    if (!row || row.used_at || row.expires_at < new Date()) {
      throw new BadRequestException('Link reset password tidak valid atau sudah kedaluwarsa. Minta link baru.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { user_id: row.user_id },
        data: { password: hashedPassword, hash_algorithm: 'bcrypt' },
      }),
      this.prisma.password_reset_tokens.update({
        where: { token },
        data: { used_at: new Date() },
      }),
    ]);
    return { reset: true };
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
