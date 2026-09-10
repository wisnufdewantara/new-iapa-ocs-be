import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConferenceDto } from './dto/create-conference.dto';
import { UpdateConferenceDto } from './dto/update-conference.dto';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class ConferenceService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async create(dto: CreateConferenceDto, actorUserId?: string) {
    const created = await this.prisma.conference.create({
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
    await this.auditLog.log(actorUserId, 'create_conference', 'conference', created.conference_id);
    return created;
  }

  async update(conferenceId: string, dto: UpdateConferenceDto, actorUserId?: string) {
    const updated = await this.prisma.conference.update({
      where: { conference_id: conferenceId },
      data: {
        conference_name: dto.conferenceName,
        conference_date: dto.conferenceDate ? new Date(dto.conferenceDate) : undefined,
        conference_end_date: dto.conferenceEndDate ? new Date(dto.conferenceEndDate) : undefined,
        status: dto.status,
      },
    });
    await this.auditLog.log(actorUserId, 'update_conference', 'conference', conferenceId);
    return updated;
  }

  async updateAwards(conferenceId: string, bestPaperId?: string, bestPresenterId?: string, actorUserId?: string) {
    const updated = await this.prisma.conference.update({
      where: { conference_id: conferenceId },
      data: {
        best_paper: bestPaperId,
        best_presenter: bestPresenterId,
      },
    });
    await this.auditLog.log(actorUserId, 'update_conference_awards', 'conference', conferenceId);
    return updated;
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
  // Semua conference yang belum "ended" (bisa lebih dari satu — coming_soon
  // DAN ongoing bisa tampil bareng di homepage), yang "ongoing" diutamakan
  // tampil duluan, baru "coming_soon", masing-masing diurutkan tanggal
  // paling dekat dulu. Sort prioritas dilakukan di JS (bukan Prisma
  // orderBy) karena "ongoing" < "coming_soon" secara alfabet padahal
  // urutan yang diinginkan kebalikannya.
  async findActive() {
    const conferences = await this.prisma.conference.findMany({
      where: { status: { not: 'ended' } },
      orderBy: { conference_date: 'asc' },
      include: {
        conference_sub_theme: true,
        conference_posters: { orderBy: { sort_order: 'asc' } },
      },
    });
    const priority = (status: string) => (status === 'ongoing' ? 0 : 1);
    return conferences.sort((a, b) => priority(a.status) - priority(b.status));
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

  // Setting per-conference (mis. tenggat pembayaran) — pindah dari
  // app_settings (yang dulunya salah ditaruh di /admin/settings, lihat
  // catatan koreksi arsitektur di SESSION_NOTES.md).
  findSettings(conferenceId: string) {
    return this.prisma.conference_settings.findMany({ where: { conference_id: conferenceId } });
  }

  upsertSetting(conferenceId: string, key: string, value: string) {
    return this.prisma.conference_settings.upsert({
      where: { conference_id_setting_key: { conference_id: conferenceId, setting_key: key } },
      create: { conference_id: conferenceId, setting_key: key, setting_value: value },
      update: { setting_value: value },
    });
  }

  findPosters(conferenceId: string) {
    return this.prisma.conference_posters.findMany({
      where: { conference_id: conferenceId },
      orderBy: { sort_order: 'asc' },
    });
  }

  async addPoster(conferenceId: string, imageUrl: string, actorUserId?: string) {
    const count = await this.prisma.conference_posters.count({ where: { conference_id: conferenceId } });
    const created = await this.prisma.conference_posters.create({
      data: { conference_id: conferenceId, image_url: imageUrl, sort_order: count },
    });
    await this.auditLog.log(actorUserId, 'add_conference_poster', 'conference_posters', created.id);
    return created;
  }

  async removePoster(posterId: string, actorUserId?: string) {
    await this.prisma.conference_posters.delete({ where: { id: posterId } });
    await this.auditLog.log(actorUserId, 'remove_conference_poster', 'conference_posters', posterId);
    return { deleted: true };
  }

  // Tukar sort_order dengan tetangga (naik = index lebih kecil, turun =
  // index lebih besar) — reorder simpel tombol naik/turun, bukan
  // drag-and-drop.
  async movePoster(conferenceId: string, posterId: string, direction: 'up' | 'down', actorUserId?: string) {
    const posters = await this.findPosters(conferenceId);
    const index = posters.findIndex((p) => p.id === posterId);
    if (index === -1) return { moved: false };
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= posters.length) return { moved: false };

    const current = posters[index];
    const target = posters[targetIndex];
    await this.prisma.$transaction([
      this.prisma.conference_posters.update({ where: { id: current.id }, data: { sort_order: target.sort_order } }),
      this.prisma.conference_posters.update({ where: { id: target.id }, data: { sort_order: current.sort_order } }),
    ]);
    await this.auditLog.log(actorUserId, 'move_conference_poster', 'conference_posters', posterId, direction);
    return { moved: true };
  }
}
