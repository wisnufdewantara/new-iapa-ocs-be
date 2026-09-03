import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConferenceService {
  constructor(private prisma: PrismaService) {}

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
      },
    });
  }

  async findLatest() {
    return this.prisma.conference.findFirst({
      orderBy: { conference_date: 'desc' },
    });
  }
}
