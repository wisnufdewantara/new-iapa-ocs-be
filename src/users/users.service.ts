import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    const users = await this.prisma.users.findMany({
      orderBy: { created_at: 'desc' },
      select: {
        user_id: true,
        username: true,
        first_name: true,
        last_name: true,
        email: true,
        role: true,
        affiliation: true,
        created_at: true,
      },
    });
    return users.map((u) => ({
      userId: u.user_id,
      username: u.username,
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      role: u.role,
      affiliation: u.affiliation,
      createdAt: u.created_at,
    }));
  }

  async create(dto: CreateUserDto, actorUserId?: string) {
    const existingUsername = await this.prisma.users.findUnique({ where: { username: dto.username } });
    if (existingUsername) throw new ConflictException('Username sudah dipakai');

    const existingEmail = await this.prisma.users.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new ConflictException('Email sudah dipakai');

    const roleExists = await this.prisma.roles.findUnique({ where: { name: dto.role } });
    if (!roleExists) throw new NotFoundException(`Role "${dto.role}" tidak ditemukan`);

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.users.create({
      data: {
        username: dto.username,
        password: hashedPassword,
        hash_algorithm: 'bcrypt',
        first_name: dto.firstName,
        last_name: dto.lastName,
        gender: dto.gender,
        affiliation: dto.affiliation,
        email: dto.email,
        phone: dto.phone,
        country: dto.country,
        role: dto.role,
      },
    });
    await this.auditLog.log(actorUserId, 'create_user', 'users', user.user_id, dto.username);
    return { userId: user.user_id, username: user.username, role: user.role };
  }

  async findOne(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        username: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        affiliation: true,
        country: true,
        gender: true,
        role: true,
        created_at: true,
      },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const [papers, participant, payments] = await Promise.all([
      this.prisma.papers.findMany({
        where: { submitter_id: userId },
        select: { paper_id: true, paper_title: true, paper_status: true, conference_status: true },
      }),
      this.prisma.participant.findUnique({
        where: { attendance_id: userId },
        select: { is_member: true, payment_status: true, total_amount: true },
      }),
      this.prisma.payments.findMany({
        where: { submitter_id: userId },
        select: { payment_id: true, total_amount: true, payment_status: true },
      }),
    ]);

    return {
      userId: user.user_id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      phone: user.phone,
      affiliation: user.affiliation,
      country: user.country,
      gender: user.gender,
      role: user.role,
      createdAt: user.created_at,
      papers: papers.map((p) => ({
        paperId: p.paper_id,
        title: p.paper_title,
        paperStatus: p.paper_status,
        conferenceStatus: p.conference_status,
      })),
      participant: participant
        ? {
            isMember: participant.is_member,
            paymentStatus: participant.payment_status,
            totalAmount: participant.total_amount != null ? Number(participant.total_amount) : null,
          }
        : null,
      payments: payments.map((p) => ({
        paymentId: p.payment_id,
        amount: p.total_amount != null ? Number(p.total_amount) : null,
        status: p.payment_status,
      })),
    };
  }

  async remove(userId: string, actorUserId: string) {
    if (userId === actorUserId) {
      throw new BadRequestException('Tidak bisa menghapus akun sendiri');
    }
    const user = await this.prisma.users.findUnique({ where: { user_id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    // Hapus user ini mengikutsertakan (cascade) paper, payment, participant,
    // dan penugasan reviewer terkait — semua relasi ke users di schema.prisma
    // memang onDelete: Cascade. FE WAJIB konfirmasi eksplisit soal ini
    // sebelum manggil endpoint ini.
    await this.prisma.users.delete({ where: { user_id: userId } });
    await this.auditLog.log(actorUserId, 'delete_user', 'users', userId, user.username);
    return { deleted: true };
  }

  async updateRole(userId: string, role: string, actorUserId?: string) {
    const user = await this.prisma.users.findUnique({ where: { user_id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const roleExists = await this.prisma.roles.findUnique({ where: { name: role } });
    if (!roleExists) throw new NotFoundException(`Role "${role}" tidak ditemukan`);

    const updated = await this.prisma.users.update({
      where: { user_id: userId },
      data: { role },
    });
    await this.auditLog.log(actorUserId, 'update_user_role', 'users', userId, role);
    return { userId: updated.user_id, role: updated.role };
  }
}
