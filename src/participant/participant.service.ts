import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConferenceService } from '../conference/conference.service';

@Injectable()
export class ParticipantService {
  constructor(
    private prisma: PrismaService,
    private conferenceService: ConferenceService,
  ) {}

  // participant.total_amount kolomnya BigInt — Express/JSON.stringify
  // nggak bisa serialize BigInt langsung, jadi dikonversi ke Number dulu
  // (nominal peserta jauh di bawah Number.MAX_SAFE_INTEGER, aman).
  private serialize<T extends { total_amount: bigint | null }>(row: T) {
    return { ...row, total_amount: row.total_amount != null ? Number(row.total_amount) : null };
  }

  async findMine(userId: string) {
    const row = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    return row ? this.serialize(row) : null;
  }

  // Niru ParticipantController/ConferenceRegistration.vue lama: join
  // dibatalkan kalau user SUDAH jadi presenter (submit paper) — arah
  // yang sama dengan legacy, TIDAK ada guard sebaliknya (submit paper
  // tetap boleh jalan meski sudah join sebagai peserta, sama seperti di
  // sana, itu bukan bug yang perlu ditutup sekarang).
  async join(userId: string, isMember: boolean, conferenceId: string) {
    const existing = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    if (existing) throw new ConflictException('Anda sudah terdaftar sebagai peserta');

    const existingPaper = await this.prisma.papers.findFirst({ where: { submitter_id: userId } });
    if (existingPaper) {
      throw new ConflictException('Anda sudah submit paper sebagai presenter, tidak bisa join sebagai peserta biasa');
    }

    // conferenceId dipilih user sendiri (bisa lebih dari 1 conference
    // aktif bareng) — divalidasi tetap ada di daftar aktif, bukan
    // langsung dipercaya mentah dari FE.
    const activeConferences = await this.conferenceService.findActive();
    const activeConference = activeConferences.find((c) => c.conference_id === conferenceId);
    if (!activeConference) {
      throw new BadRequestException('Conference yang dipilih tidak aktif atau tidak ditemukan');
    }

    // total_amount & payment_status SENGAJA tidak diisi manual — trigger
    // DB create_payment_for_participant (BEFORE INSERT) yang ngitung
    // otomatis (300rb member / 500rb non-member). Legacy dulu override
    // manual jadi 0, itu bug, jangan ditiru.
    const created = await this.prisma.participant.create({
      data: {
        attendance_id: userId,
        conference_id: activeConference.conference_id,
        is_member: isMember,
        role: 'Participant',
      },
    });
    return this.serialize(created);
  }
}
