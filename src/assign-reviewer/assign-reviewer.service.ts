import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';

@Injectable()
export class AssignReviewerService {
  constructor(private prisma: PrismaService) {}

  async listReviewers() {
    const reviewers = await this.prisma.users.findMany({
      where: { role: 'Reviewer' },
      select: { user_id: true, first_name: true, last_name: true, email: true },
    });
    return reviewers.map((r) => ({
      reviewerId: r.user_id,
      name: `${r.first_name} ${r.last_name}`,
      email: r.email,
    }));
  }

  async listByConference(conferenceId: string) {
    const papers = await this.prisma.papers.findMany({
      where: { conference_id: conferenceId },
      orderBy: { upload_date: 'desc' },
      select: {
        paper_id: true,
        paper_title: true,
        paper_status: true,
        paper_writers: { where: { role: 'presenter' }, select: { first_name: true, last_name: true } },
        paper_reviewer: {
          select: {
            review_id: true,
            deadline: true,
            accepted: true,
            users_paper_reviewer_reviewer_idTousers: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });

    return papers.map((p) => ({
      paperId: p.paper_id,
      paperTitle: p.paper_title,
      paperStatus: p.paper_status,
      presenterName: p.paper_writers[0] ? `${p.paper_writers[0].first_name} ${p.paper_writers[0].last_name}` : null,
      reviewers: p.paper_reviewer.map((pr) => ({
        reviewId: pr.review_id,
        name: `${pr.users_paper_reviewer_reviewer_idTousers.first_name} ${pr.users_paper_reviewer_reviewer_idTousers.last_name}`,
        deadline: pr.deadline,
        accepted: pr.accepted,
      })),
    }));
  }

  async assign(managerId: string, dto: AssignReviewerDto) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: dto.paperId },
      include: { paper_writers: { where: { role: 'presenter' } } },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');
    if (!paper.submitter_id) throw new BadRequestException('Paper tidak punya submitter');

    const existing = await this.prisma.paper_reviewer.findFirst({
      where: { paper_id: dto.paperId, reviewer_id: dto.reviewerId },
    });
    if (existing) throw new BadRequestException('Reviewer ini sudah ditugaskan ke paper ini');

    const writerName = paper.paper_writers[0]
      ? `${paper.paper_writers[0].first_name} ${paper.paper_writers[0].last_name}`
      : paper.paper_title;

    const [reviewRow] = await this.prisma.$transaction([
      this.prisma.paper_reviewer.create({
        data: {
          paper_id: dto.paperId,
          reviewer_id: dto.reviewerId,
          submitter_id: paper.submitter_id,
          paper_title: paper.paper_title,
          writer_name: writerName,
          deadline: new Date(dto.deadline),
          manager_id: managerId,
          conference_id: paper.conference_id,
        },
      }),
      this.prisma.papers.update({ where: { paper_id: dto.paperId }, data: { paper_status: 'Assigned' } }),
    ]);

    return reviewRow;
  }
}
