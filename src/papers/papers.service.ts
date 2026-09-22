import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorInput } from './dto/author-input.dto';
import { SubmitPaperDto } from './dto/submit-paper.dto';
import { AuditLogService } from '../common/audit-log.service';
import { ConferenceService } from '../conference/conference.service';
import { Ocs2SyncService } from '../payment/ocs2-sync.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d+$/;

@Injectable()
export class PapersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private conferenceService: ConferenceService,
    private ocs2Sync: Ocs2SyncService,
  ) {}

  async findMine(userId: string) {
    const paper = await this.prisma.papers.findFirst({
      where: { submitter_id: userId },
      orderBy: { upload_date: 'desc' },
      select: {
        paper_id: true,
        paper_title: true,
        conference_status: true,
        paper_status: true,
        document_url: true,
        review_feedback: true,
      },
    });
    return paper
      ? {
          paperId: paper.paper_id,
          paperTitle: paper.paper_title,
          conferenceStatus: paper.conference_status,
          paperStatus: paper.paper_status,
          documentUrl: paper.document_url,
          reviewFeedback: paper.review_feedback,
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

    // conferenceId dipilih user sendiri (bisa lebih dari 1 conference
    // aktif bareng — dulu di sini ada query findFirst sendiri yang
    // otomatis milih satu tanpa nanya user DAN nggak prioritaskan
    // ongoing, itu bug duplikat dari versi lama ConferenceService yang
    // udah dibenerin di tempat lain tapi kelewat di sini).
    const activeConferences = await this.conferenceService.findActive();
    const activeConference = activeConferences.find((c) => c.conference_id === dto.conferenceId);
    if (!activeConference) {
      throw new BadRequestException('Conference yang dipilih tidak aktif atau tidak ditemukan');
    }

    // Toggle per-conference buat nutup submission (mis. lewat tenggat),
    // independen dari status conference (yang juga ngatur banyak hal
    // lain kayak tampil di homepage) — default kebuka kalau belum
    // pernah diatur admin, biar conference lama nggak keblokir tiba-tiba.
    const submissionSetting = await this.prisma.conference_settings.findUnique({
      where: { conference_id_setting_key: { conference_id: dto.conferenceId, setting_key: 'papers_submission_open' } },
    });
    if (submissionSetting?.setting_value === 'false') {
      throw new BadRequestException('Submission paper untuk conference ini sudah ditutup');
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
          create: authors.map((a, index) => ({
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
            writer_order: index,
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
          orderBy: { writer_order: 'asc' },
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
      authorNames: p.paper_writers.map((w) => `${w.first_name} ${w.last_name}`),
    }));
  }

  async updateStatus(
    paperId: string,
    conferenceStatus: 'Waiting' | 'Accepted' | 'Rejected',
    actorUserId?: string,
    reviewFeedback?: string,
  ) {
    // 'Waiting' dipakai juga buat "Batalkan Keputusan" (cancel decision) —
    // balikin paper_status ke Unassigned secara eksplisit, BUKAN `undefined`
    // (yang di Prisma artinya "jangan sentuh field ini"). Sebelumnya bug
    // ini bikin conference_status balik ke Waiting tapi paper_status
    // nyangkut di Accepted/Rejected lama — dua kolom itu jadi nggak
    // konsisten, tepat masalah yang bikin data 33 paper harus dibenerin
    // manual lewat SQL di sistem lama (lihat SESSION_NOTES.md).
    const updated = await this.prisma.papers.update({
      where: { paper_id: paperId },
      data: {
        conference_status: conferenceStatus,
        // paper_status ikut di-set (bukan cuma conference_status) karena
        // trigger DB trigger_create_payment (migrasi dari database lama)
        // fire di paper_status = 'Accepted', bukan conference_status —
        // tanpa ini baris payments nggak pernah otomatis kebuat buat
        // paper baru yang di-accept lewat newocs.
        paper_status: conferenceStatus === 'Waiting' ? 'Unassigned' : conferenceStatus,
        // Cuma disentuh kalau reviewer ngisi sesuatu — biar reject/accept
        // tanpa catatan (misal lewat bulk) nggak nimpa feedback lama jadi
        // undefined/hilang.
        ...(reviewFeedback !== undefined ? { review_feedback: reviewFeedback } : {}),
      },
    });
    const action = conferenceStatus === 'Waiting' ? 'paper_cancel_decision' : `paper_${conferenceStatus.toLowerCase()}`;
    await this.auditLog.log(actorUserId, action, 'papers', paperId);

    // newocs sekarang sumber utama buat keputusan Accept/Reject — push
    // balik ke ocs2/Supabase biar peserta yang masih cek status di
    // ocs2.iapa.or.id tetap lihat data yang sama. Ocs2SyncService nangkep
    // error-nya sendiri (nggak throw), jadi await di sini nggak bikin
    // response ke admin gagal cuma gara-gara sync-nya bermasalah.
    await this.ocs2Sync.pushPaperStatusByPaperId(paperId, updated.paper_status, conferenceStatus, reviewFeedback);

    return updated;
  }

  // Nggak ada pengiriman email di updateStatus() sama sekali, jadi beda
  // dari bug lama di ocs2 (bulk accept/reject di sana sempat kirim email
  // duluan sebelum status kesimpen — kalau emailnya gagal, keputusannya
  // ikut nggak pernah tersimpan). Di sini per-paper try/catch murni buat
  // isolasi 1 paper gagal (misal paperId salah) dari paper lain di batch.
  async updateStatusBulk(
    paperIds: string[],
    conferenceStatus: 'Accepted' | 'Rejected',
    actorUserId?: string,
  ) {
    const results: { paperId: string; success: boolean; error?: string }[] = [];
    for (const paperId of paperIds) {
      try {
        await this.updateStatus(paperId, conferenceStatus, actorUserId);
        results.push({ paperId, success: true });
      } catch (e: any) {
        results.push({ paperId, success: false, error: e.message });
      }
    }
    return results;
  }
}
