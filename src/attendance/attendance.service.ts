import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToggleParticipantAttendanceDto, ToggleTeamAttendanceDto } from './dto/toggle-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  // Presensi tim/presenter — satu baris per presenter dari paper yang
  // sudah Accepted di conference ini.
  async teamByConference(conferenceId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { conference_id: conferenceId, conference_status: 'Accepted' },
      select: {
        paper_id: true,
        paper_title: true,
        paper_writers: {
          where: { role: 'presenter' },
          select: {
            writer_id: true,
            first_name: true,
            last_name: true,
            attendance: { where: { conference_id: conferenceId }, select: { presence: true } },
          },
        },
      },
    });

    return papers.flatMap((paper) =>
      paper.paper_writers.map((w) => ({
        writerId: w.writer_id,
        paperTitle: paper.paper_title,
        presenterName: `${w.first_name} ${w.last_name}`,
        present: w.attendance[0]?.presence ?? false,
      })),
    );
  }

  async toggleTeam(conferenceId: string, dto: ToggleTeamAttendanceDto) {
    const writer = await this.prisma.paper_writers.findUnique({ where: { writer_id: dto.writerId } });
    if (!writer) throw new NotFoundException('Presenter tidak ditemukan');

    const existing = await this.prisma.attendance.findFirst({
      where: { writer_id: dto.writerId, conference_id: conferenceId },
    });

    if (existing) {
      return this.prisma.attendance.update({ where: { id: existing.id }, data: { presence: dto.present } });
    }
    return this.prisma.attendance.create({
      data: {
        writer_id: dto.writerId,
        paper_id: writer.paper_id,
        conference_id: conferenceId,
        presence: dto.present,
      },
    });
  }

  // Presensi peserta non-presenter.
  async participantsByConference(conferenceId: string) {
    const participants = await this.prisma.participant.findMany({
      where: { conference_id: conferenceId },
      select: {
        attendance_id: true,
        users: { select: { first_name: true, last_name: true, email: true } },
        attendance: { where: { conference_id: conferenceId }, select: { presence: true } },
      },
    });

    return participants.map((p) => ({
      participantId: p.attendance_id,
      name: `${p.users.first_name} ${p.users.last_name}`,
      email: p.users.email,
      present: p.attendance[0]?.presence ?? false,
    }));
  }

  async toggleParticipant(conferenceId: string, dto: ToggleParticipantAttendanceDto) {
    const participant = await this.prisma.participant.findUnique({ where: { attendance_id: dto.participantId } });
    if (!participant) throw new NotFoundException('Peserta tidak ditemukan');

    const existing = await this.prisma.attendance.findFirst({
      where: { participant_id: dto.participantId, conference_id: conferenceId },
    });

    if (existing) {
      return this.prisma.attendance.update({ where: { id: existing.id }, data: { presence: dto.present } });
    }
    return this.prisma.attendance.create({
      data: {
        participant_id: dto.participantId,
        conference_id: conferenceId,
        presence: dto.present,
      },
    });
  }
}
