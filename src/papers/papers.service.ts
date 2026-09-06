import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorInput } from './dto/author-input.dto';
import { SubmitPaperDto } from './dto/submit-paper.dto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d+$/;

@Injectable()
export class PapersService {
  constructor(private prisma: PrismaService) {}

  async findMine(userId: string) {
    const paper = await this.prisma.papers.findFirst({
      where: { submitter_id: userId },
      orderBy: { upload_date: 'desc' },
      select: { paper_id: true, paper_title: true, conference_status: true, paper_status: true, document_url: true },
    });
    return paper
      ? {
          paperId: paper.paper_id,
          paperTitle: paper.paper_title,
          conferenceStatus: paper.conference_status,
          paperStatus: paper.paper_status,
          documentUrl: paper.document_url,
        }
      : null;
  }

  // Validasi manual niru validatePaperWriter di PaperServiceImpl.java lama
  // (nggak pakai bean-validation annotation di backend Java aslinya).
  private validateAuthor(author: AuthorInput) {
    if (!author.firstName?.trim() || !author.lastName?.trim() || !author.affiliation?.trim()) {
      throw new BadRequestException('Nama dan afiliasi penulis wajib diisi');
    }
    if (!['male', 'female', 'other'].includes(author.gender)) {
      throw new BadRequestException('Gender penulis tidak valid');
    }
    if (!EMAIL_PATTERN.test(author.email ?? '')) {
      throw new BadRequestException(`Email penulis tidak valid: ${author.email}`);
    }
    if (!PHONE_PATTERN.test(author.phoneNumber ?? '')) {
      throw new BadRequestException(`Nomor telepon penulis tidak valid: ${author.phoneNumber}`);
    }
  }

  async submitPaper(userId: string, dto: SubmitPaperDto, documentUrl: string) {
    if (!dto.paperTitle?.trim() || /^\d+$/.test(dto.paperTitle.trim())) {
      throw new BadRequestException('Judul paper tidak valid');
    }

    let authors: AuthorInput[];
    try {
      authors = JSON.parse(dto.authors);
    } catch {
      throw new BadRequestException('Data penulis tidak valid');
    }
    if (!Array.isArray(authors) || authors.length === 0) {
      throw new BadRequestException('Minimal harus ada satu penulis');
    }
    authors.forEach((a) => this.validateAuthor(a));

    const activeConference = await this.prisma.conference.findFirst({
      where: { status: { not: 'ended' } },
      orderBy: { conference_date: 'asc' },
    });
    if (!activeConference) {
      throw new BadRequestException('Tidak ada conference yang sedang aktif untuk submit paper');
    }

    // Kalau email penulis cocok user terdaftar, kolom user_id (FK) diisi
    // biar linknya konsisten — writer_id (PK) tetap UUID baru tiap kali,
    // biar aman kalau orang yang sama jadi co-author di paper lain juga.
    const matchedUsers = await this.prisma.users.findMany({
      where: { email: { in: authors.map((a) => a.email.trim()) } },
      select: { user_id: true, email: true },
    });
    const userIdByEmail = new Map(matchedUsers.map((u) => [u.email.toLowerCase(), u.user_id]));

    const paper = await this.prisma.papers.create({
      data: {
        paper_title: dto.paperTitle.trim(),
        submitter_id: userId,
        document_url: documentUrl,
        paper_status: 'Unassigned',
        conference_status: 'Waiting',
        sent_loa: false,
        sent_confirmation: false,
        conference_id: activeConference.conference_id,
        type: 'Offline',
        abstract_text: dto.abstractText,
        keywords: dto.keywords,
        sub_theme: dto.subTheme,
        paper_writers: {
          create: authors.map((a) => ({
            writer_id: randomUUID(),
            first_name: a.firstName.trim(),
            last_name: a.lastName.trim(),
            gender: a.gender,
            affiliation: a.affiliation.trim(),
            email: a.email.trim(),
            phone_number: a.phoneNumber.trim(),
            member_status: a.statusMember ?? false,
            role: 'presenter',
            user_id: userIdByEmail.get(a.email.trim().toLowerCase()),
          })),
        },
      },
      select: { paper_id: true, paper_title: true, conference_status: true, paper_status: true },
    });

    return { paperId: paper.paper_id, paperTitle: paper.paper_title, conferenceStatus: paper.conference_status, paperStatus: paper.paper_status };
  }

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
