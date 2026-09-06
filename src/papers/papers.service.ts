import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PapersService {
  constructor(private prisma: PrismaService) {}

  async findByConference(conferenceId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { conference_id: conferenceId },
      orderBy: { upload_date: 'desc' },
      select: {
        paper_id: true,
        paper_title: true,
        document_url: true,
        conference_status: true,
        type: true,
        sub_theme: true,
        paper_writers: {
          where: { role: 'presenter' },
          select: { first_name: true, last_name: true, email: true },
        },
      },
    });

    return papers.map((p) => ({
      paperId: p.paper_id,
      paperTitle: p.paper_title,
      documentUrl: p.document_url,
      conferenceStatus: p.conference_status,
      type: p.type,
      subTheme: p.sub_theme,
      presenterName: p.paper_writers[0] ? `${p.paper_writers[0].first_name} ${p.paper_writers[0].last_name}` : null,
      presenterEmail: p.paper_writers[0]?.email ?? null,
    }));
  }

  updateStatus(paperId: string, conferenceStatus: 'Waiting' | 'Accepted' | 'Rejected') {
    return this.prisma.papers.update({
      where: { paper_id: paperId },
      data: { conference_status: conferenceStatus },
    });
  }
}
