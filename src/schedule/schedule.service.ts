import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';

@Injectable()
export class ScheduleService {
  constructor(private prisma: PrismaService) {}

  findByConference(conferenceId: string) {
    return this.prisma.schedule.findMany({
      where: { conference_id: conferenceId },
      orderBy: [{ schedule_date: 'asc' }, { schedule_time: 'asc' }],
      include: { papers: { select: { paper_title: true } } },
    });
  }

  // Paper yang sudah Accepted di conference ini dan punya presenter,
  // jadi pilihan di dropdown "Tambah Jadwal" — sama seperti logika
  // ScheduleController.getPapersForScheduling di backend Java lama.
  async eligiblePapers(conferenceId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { conference_id: conferenceId, conference_status: 'Accepted' },
      select: {
        paper_id: true,
        paper_title: true,
        paper_writers: { where: { role: 'presenter' }, select: { first_name: true, last_name: true, email: true } },
      },
    });
    return papers.map((p) => ({
      paperId: p.paper_id,
      paperTitle: p.paper_title,
      presenterName: p.paper_writers[0] ? `${p.paper_writers[0].first_name} ${p.paper_writers[0].last_name}` : null,
      presenterEmail: p.paper_writers[0]?.email ?? null,
    }));
  }

  async create(conferenceId: string, dto: CreateScheduleDto) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: dto.paperId },
      include: { paper_writers: { where: { role: 'presenter' } } },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');

    const presenter = paper.paper_writers[0];
    const [hours, minutes] = dto.scheduleTime.split(':').map(Number);
    const scheduleTime = new Date(Date.UTC(1970, 0, 1, hours, minutes));

    return this.prisma.schedule.create({
      data: {
        conference_id: conferenceId,
        paper_id: dto.paperId,
        presenter_name: presenter ? `${presenter.first_name} ${presenter.last_name}` : paper.paper_title,
        presenter_email: presenter?.email,
        schedule_date: new Date(dto.scheduleDate),
        schedule_time: scheduleTime,
        session_name: dto.sessionName,
        room: dto.room,
        type: dto.type,
      },
    });
  }
}
