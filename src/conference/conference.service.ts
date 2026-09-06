import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConferenceDto } from './dto/create-conference.dto';
import { UpdateConferenceDto } from './dto/update-conference.dto';

@Injectable()
export class ConferenceService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateConferenceDto) {
    return this.prisma.conference.create({
      data: {
        conference_name: dto.conferenceName,
        conference_date: new Date(dto.conferenceDate),
        conference_end_date: dto.conferenceEndDate ? new Date(dto.conferenceEndDate) : null,
        status: dto.status ?? 'coming_soon',
        conference_sub_theme: dto.subThemes?.length
          ? { create: dto.subThemes.map((sub_theme) => ({ sub_theme })) }
          : undefined,
      },
      include: { conference_sub_theme: true },
    });
  }

  update(conferenceId: string, dto: UpdateConferenceDto) {
    return this.prisma.conference.update({
      where: { conference_id: conferenceId },
      data: {
        conference_name: dto.conferenceName,
        conference_date: dto.conferenceDate ? new Date(dto.conferenceDate) : undefined,
        conference_end_date: dto.conferenceEndDate ? new Date(dto.conferenceEndDate) : undefined,
        status: dto.status,
      },
    });
  }

  findAll(year?: string) {
    return this.prisma.conference.findMany({
      where: year
        ? { conference_date: { gte: new Date(`${year}-01-01`), lt: new Date(`${Number(year) + 1}-01-01`) } }
        : undefined,
      orderBy: { conference_date: 'desc' },
      select: {
        conference_id: true,
        conference_name: true,
        conference_date: true,
        conference_end_date: true,
        status: true,
      },
    });
  }

  async findLatest() {
    return this.prisma.conference.findFirst({
      orderBy: { conference_date: 'desc' },
    });
  }

  // Dipakai homepage publik: conference yang statusnya belum "ended"
  // (coming_soon/ongoing), diurutkan yang tanggalnya paling dekat duluan.
  // Status di sini murni manual dari admin (bukan dihitung dari tanggal),
  // jadi field ini yang jadi sumber kebenaran, bukan conference_date.
  findActive() {
    return this.prisma.conference.findFirst({
      where: { status: { not: 'ended' } },
      orderBy: { conference_date: 'asc' },
    });
  }

  // Riwayat event yang sudah berakhir, buat halaman /event-history.
  findHistory() {
    return this.prisma.conference.findMany({
      where: { status: 'ended' },
      orderBy: { conference_date: 'desc' },
      select: {
        conference_id: true,
        conference_name: true,
        conference_date: true,
        conference_end_date: true,
      },
    });
  }

  // Detail satu event yang sudah berakhir, termasuk juara (best paper &
  // best presenter) buat halaman /event-history/:id.
  async findHistoryDetail(conferenceId: string) {
    return this.prisma.conference.findUnique({
      where: { conference_id: conferenceId },
      include: {
        conference_sub_theme: true,
        papers_conference_best_paperTopapers: {
          select: {
            paper_title: true,
            paper_writers: { where: { role: 'presenter' }, select: { first_name: true, last_name: true } },
          },
        },
        paper_writers: { select: { first_name: true, last_name: true } },
      },
    });
  }
}
