import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConferenceService } from '../conference/conference.service';
import { AuditLogService } from '../common/audit-log.service';
import { participantFee } from '../payment/pricing.constant';

@Injectable()
export class ParticipantService {
  constructor(
    private prisma: PrismaService,
    private conferenceService: ConferenceService,
    private auditLog: AuditLogService,
  ) {}

  // participant.total_amount kolomnya BigInt — Express/JSON.stringify
  // nggak bisa serialize BigInt langsung, jadi dikonversi ke Number dulu
  // (nominal peserta jauh di bawah Number.MAX_SAFE_INTEGER, aman).
  private serialize<T extends { total_amount: bigint | null }>(row: T) {
    return { ...row, total_amount: row.total_amount != null ? Number(row.total_amount) : null };
  }

  async findMine(userId: string) {
    const row = await this.prisma.participant.findUnique({
      where: { attendance_id: userId },
      include: { conference: { select: { conference_name: true } } },
    });
    if (!row) return null;
    const { conference, ...rest } = row;
    return { ...this.serialize(rest), conference_name: conference?.conference_name ?? null };
  }

  // Niru ParticipantController/ConferenceRegistration.vue lama: join
  // dibatalkan kalau user SUDAH jadi presenter (submit paper) — tapi
  // sekarang dicek PER CONFERENCE (dulu global: presenter 2025 jadi nggak
  // bisa join 2026 sama sekali). TIDAK ada guard sebaliknya (submit paper
  // tetap boleh meski sudah join sebagai peserta), sama seperti legacy.
  async join(userId: string, isMember: boolean, conferenceId: string) {
    // conferenceId dipilih user sendiri (bisa lebih dari 1 conference
    // aktif bareng) — divalidasi tetap ada di daftar aktif, bukan
    // langsung dipercaya mentah dari FE.
    const activeConferences = await this.conferenceService.findActive();
    const activeConference = activeConferences.find((c) => c.conference_id === conferenceId);
    if (!activeConference) {
      throw new BadRequestException('Conference yang dipilih tidak aktif atau tidak ditemukan');
    }

    const existingPaper = await this.prisma.papers.findFirst({
      where: { submitter_id: userId, conference_id: conferenceId },
    });
    if (existingPaper) {
      throw new ConflictException('Anda sudah submit paper sebagai presenter di conference ini, tidak perlu join sebagai peserta biasa');
    }

    const existing = await this.prisma.participant.findUnique({ where: { attendance_id: userId } });
    if (!existing) {
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
      // Trigger yang sama juga nyetel status 'waiting for calculation',
      // padahal nominal peserta udah final saat itu juga — langsung naikin
      // ke 'waiting for payment' biar peserta bisa upload bukti.
      if (created.total_amount != null && created.payment_status === 'waiting for calculation') {
        return this.serialize(
          await this.prisma.participant.update({
            where: { attendance_id: userId },
            data: { payment_status: 'waiting for payment' },
          }),
        );
      }
      return this.serialize(created);
    }

    if (existing.conference_id === conferenceId) {
      throw new ConflictException('Anda sudah terdaftar sebagai peserta di conference ini');
    }
    // Primary key participant = user_id (warisan skema ocs2), jadi 1 akun
    // cuma bisa punya 1 baris peserta. Kalau baris itu milik conference
    // yang MASIH aktif, jangan dipindah — itu bakal ngehapus pendaftaran
    // yang masih jalan.
    if (activeConferences.some((c) => c.conference_id === existing.conference_id)) {
      throw new ConflictException(
        'Anda masih terdaftar sebagai peserta di conference lain yang sedang berjalan. Hubungi admin.',
      );
    }

    // Baris lama milik conference yang sudah selesai → dipakai ulang buat
    // conference baru. Data lamanya diarsipkan dulu ke audit_log (presensi
    // & sertifikat lama aman — tabel attendance punya conference_id
    // sendiri). Trigger BEFORE INSERT nggak jalan di UPDATE, jadi nominal
    // dihitung di sini pakai harga yang sama.
    await this.auditLog.log(
      userId,
      'participant_rejoin_archive',
      'participant',
      userId,
      JSON.stringify({ ...existing, total_amount: existing.total_amount != null ? Number(existing.total_amount) : null }),
    );
    const updated = await this.prisma.participant.update({
      where: { attendance_id: userId },
      data: {
        conference_id: activeConference.conference_id,
        is_member: isMember,
        role: 'Participant',
        total_amount: BigInt(participantFee(isMember)),
        payment_status: 'waiting for payment',
        link_payment_upload: null,
        payment_sender_name: null,
        payment_transfer_date: null,
        description: null,
        sent_invoice: false,
        sent_price: false,
      },
    });
    return this.serialize(updated);
  }
}
