import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';
import { MailerService } from '../mailer/mailer.service';
import { EmailTemplateService } from '../email-template/email-template.service';
import { signFileToken } from '../common/file-access-token.util';
import { StoredFileLocation, resolveStoredFile } from '../common/upload-path.util';
import { signedDocumentUrl, signedFeedbackUrl } from '../papers/papers.service';

export type FeedbackSide = 'reviewer' | 'author';
export const REVIEWER_TEAM_LABEL = 'Tim Reviewer';
const MAX_BODY_LENGTH = 5000;

function frontendBase(): string {
  return (process.env.FRONTEND_URL || 'https://dev-ocs.iapa.or.id').replace(/\/$/, '');
}

export function signedFeedbackMessageFileUrl(messageId: string): string {
  return `${frontendBase()}/api/paper-feedback/files/${messageId}?token=${signFileToken('feedback-message', messageId)}`;
}

export interface ThreadMessage {
  id: string;
  side: FeedbackSide;
  senderName: string;
  body: string | null;
  fileUrl: string | null;
  fileName: string | null;
  createdAt: Date | null;
  legacy: boolean;
}

// Thread feedback reviewer <-> penulis (pengganti "Send Feedback" sekali
// kirim ala ocs2). Identitas reviewer disamarkan jadi "Tim Reviewer" HANYA
// di tampilan sisi penulis — di DB selalu tersimpan pengirim aslinya.
@Injectable()
export class PaperFeedbackService {
  private readonly logger = new Logger(PaperFeedbackService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private mailer: MailerService,
    private emailTemplate: EmailTemplateService,
  ) {}

  // viewer 'reviewer' = nama asli pengirim kelihatan; 'author' = pesan sisi
  // reviewer jadi "Tim Reviewer". Feedback lama (kolom papers) ditaruh
  // paling atas sebagai pesan reviewer.
  private async buildThread(paperId: string, viewer: FeedbackSide): Promise<ThreadMessage[]> {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      select: {
        review_feedback: true,
        feedback_url: true,
        accepted_at: true,
        upload_date: true,
        users: { select: { first_name: true, last_name: true } },
      },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');

    const legacyAt = paper.accepted_at ?? paper.upload_date ?? null;
    const legacy: ThreadMessage[] = [];
    if (paper.review_feedback?.trim()) {
      legacy.push({
        id: 'legacy-note',
        side: 'reviewer',
        senderName: REVIEWER_TEAM_LABEL,
        body: paper.review_feedback,
        fileUrl: null,
        fileName: null,
        createdAt: legacyAt,
        legacy: true,
      });
    }
    if (paper.feedback_url) {
      legacy.push({
        id: 'legacy-file',
        side: 'reviewer',
        senderName: REVIEWER_TEAM_LABEL,
        body: null,
        fileUrl: signedFeedbackUrl(paperId),
        fileName: 'Feedback reviewer',
        createdAt: legacyAt,
        legacy: true,
      });
    }

    const rows = await this.prisma.paper_feedback_messages.findMany({
      where: { paper_id: paperId },
      orderBy: { created_at: 'asc' },
      include: { users: { select: { first_name: true, last_name: true } } },
    });
    const authorName = paper.users ? `${paper.users.first_name} ${paper.users.last_name}`.trim() : 'Penulis';

    return [
      ...legacy,
      ...rows.map((m) => {
        const realName = m.users ? `${m.users.first_name} ${m.users.last_name}`.trim() : null;
        const senderName =
          m.side === 'reviewer'
            ? viewer === 'author'
              ? REVIEWER_TEAM_LABEL
              : `${realName ?? 'Akun terhapus'} (Tim Reviewer)`
            : (realName ?? authorName);
        return {
          id: m.id,
          side: m.side as FeedbackSide,
          senderName,
          body: m.body,
          fileUrl: m.file_url ? signedFeedbackMessageFileUrl(m.id) : null,
          fileName: m.file_name,
          createdAt: m.created_at,
          legacy: false,
        };
      }),
    ];
  }

  async reviewerDetail(paperId: string) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      select: {
        paper_id: true,
        paper_title: true,
        abstract_text: true,
        keywords: true,
        type: true,
        sub_theme: true,
        conference_status: true,
        document_url: true,
        conference_papers_conference_idToconference: { select: { conference_id: true, conference_name: true } },
        users: { select: { first_name: true, last_name: true, email: true } },
        paper_writers: {
          orderBy: { writer_order: 'asc' },
          select: { first_name: true, last_name: true, email: true, affiliation: true, role: true },
        },
        payments: { select: { payment_id: true }, take: 1 },
      },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');
    return {
      paperId: paper.paper_id,
      paperTitle: paper.paper_title,
      abstract: paper.abstract_text,
      keywords: paper.keywords,
      type: paper.type,
      subTheme: paper.sub_theme,
      conferenceStatus: paper.conference_status,
      conferenceId: paper.conference_papers_conference_idToconference?.conference_id ?? null,
      conferenceName: paper.conference_papers_conference_idToconference?.conference_name ?? null,
      documentUrl: paper.document_url ? signedDocumentUrl(paper.paper_id) : null,
      paymentId: paper.payments[0]?.payment_id ?? null,
      submitter: paper.users
        ? { name: `${paper.users.first_name} ${paper.users.last_name}`.trim(), email: paper.users.email }
        : null,
      writers: paper.paper_writers.map((w) => ({
        name: `${w.first_name} ${w.last_name}`.trim(),
        email: w.email,
        affiliation: w.affiliation,
        role: w.role,
      })),
      messages: await this.buildThread(paperId, 'reviewer'),
    };
  }

  async authorThread(paperId: string, userId: string) {
    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      select: {
        paper_id: true,
        paper_title: true,
        submitter_id: true,
        conference_status: true,
        conference_papers_conference_idToconference: { select: { conference_name: true } },
      },
    });
    if (!paper || paper.submitter_id !== userId) throw new NotFoundException('Paper tidak ditemukan');
    return {
      paperId: paper.paper_id,
      paperTitle: paper.paper_title,
      conferenceStatus: paper.conference_status,
      conferenceName: paper.conference_papers_conference_idToconference?.conference_name ?? null,
      messages: await this.buildThread(paperId, 'author'),
    };
  }

  async postMessage(
    paperId: string,
    side: FeedbackSide,
    senderUserId: string,
    body: string | undefined,
    file: { url: string; name: string } | null,
  ) {
    const text = body?.trim() || null;
    if (!text && !file) throw new BadRequestException('Isi pesan atau lampirkan file');
    if (text && text.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(`Pesan maksimal ${MAX_BODY_LENGTH} karakter`);
    }

    const paper = await this.prisma.papers.findUnique({
      where: { paper_id: paperId },
      select: {
        paper_title: true,
        submitter_id: true,
        users: { select: { first_name: true, email: true } },
        conference_papers_conference_idToconference: { select: { conference_name: true } },
      },
    });
    if (!paper) throw new NotFoundException('Paper tidak ditemukan');
    if (side === 'author' && paper.submitter_id !== senderUserId) {
      throw new ForbiddenException('Paper ini bukan milik Anda');
    }

    const created = await this.prisma.paper_feedback_messages.create({
      data: {
        paper_id: paperId,
        sender_user_id: senderUserId,
        side,
        body: text,
        file_url: file?.url ?? null,
        file_name: file?.name ?? null,
      },
    });
    await this.auditLog.log(senderUserId, `paper_feedback_${side}`, 'papers', paperId, created.id);

    // Email cuma ke penulis (pesan dari reviewer). Balasan penulis nggak
    // di-email — sisi reviewer lihat badge "Balasan baru" di Review Paper.
    let emailSent: boolean | null = null;
    let emailError: string | undefined;
    if (side === 'reviewer' && paper.users?.email) {
      try {
        const threadLink = `${frontendBase()}/dashboard/feedback/${paperId}`;
        const { subject, bodyHtml } = await this.emailTemplate.render('paper_feedback', {
          firstName: paper.users.first_name,
          paperTitle: paper.paper_title,
          conferenceName: paper.conference_papers_conference_idToconference?.conference_name ?? 'IAPA Conference',
          threadLink,
          // alias lama — biar override template versi sebelumnya tetap jalan
          feedbackLink: threadLink,
          dashboardLink: threadLink,
        });
        await this.mailer.sendMail(paper.users.email, subject, bodyHtml, undefined, {
          type: 'paper_feedback',
          relatedId: paperId,
        });
        emailSent = true;
      } catch (err: any) {
        this.logger.error(`Gagal kirim email feedback paper ${paperId}: ${err.message}`);
        emailSent = false;
        emailError = err.message;
      }
    }
    return { messageId: created.id, emailSent, emailError };
  }

  async getMessageFileLocation(messageId: string): Promise<StoredFileLocation> {
    const msg = await this.prisma.paper_feedback_messages.findUnique({
      where: { id: messageId },
      select: { file_url: true },
    });
    if (!msg?.file_url) throw new NotFoundException('File tidak ditemukan');
    return resolveStoredFile(msg.file_url);
  }

  // Ringkasan per paper buat tabel Review Paper (jumlah pesan + apakah
  // pesan terakhir dari penulis = perlu dibalas) dan Dashboard penulis.
  async summaries(paperIds: string[]) {
    const out = new Map<string, { count: number; lastSide: FeedbackSide | null }>();
    if (paperIds.length === 0) return out;
    const rows = await this.prisma.paper_feedback_messages.findMany({
      where: { paper_id: { in: paperIds } },
      orderBy: { created_at: 'asc' },
      select: { paper_id: true, side: true },
    });
    for (const r of rows) {
      const cur = out.get(r.paper_id) ?? { count: 0, lastSide: null };
      cur.count++;
      cur.lastSide = r.side as FeedbackSide;
      out.set(r.paper_id, cur);
    }
    return out;
  }

  // Laporan admin — pengirim ASLI selalu ditampilkan di sini.
  async reportRows(conferenceId?: string): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.paper_feedback_messages.findMany({
      where: conferenceId ? { papers: { conference_id: conferenceId } } : {},
      orderBy: [{ paper_id: 'asc' }, { created_at: 'asc' }],
      include: {
        users: { select: { first_name: true, last_name: true, email: true } },
        papers: {
          select: {
            paper_title: true,
            conference_papers_conference_idToconference: { select: { conference_name: true } },
          },
        },
      },
    });
    return rows.map((m) => ({
      paperTitle: m.papers.paper_title,
      conference: m.papers.conference_papers_conference_idToconference?.conference_name ?? '',
      createdAt: m.created_at.toISOString().replace('T', ' ').slice(0, 19),
      side: m.side === 'reviewer' ? 'Reviewer' : 'Penulis',
      senderName: m.users ? `${m.users.first_name} ${m.users.last_name}`.trim() : '(akun terhapus)',
      senderEmail: m.users?.email ?? '',
      body: m.body ?? '',
      fileUrl: m.file_url ? signedFeedbackMessageFileUrl(m.id) : '',
    }));
  }
}
