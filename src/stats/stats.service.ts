import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConferenceService } from '../conference/conference.service';
import { computePresenterTotal, matchSubmitterWriter } from '../payment/presenter-fee.util';

// Dashboard Keuangan + Statistik + ringkasan "perlu ditindaklanjuti".
// SEMUA di sini read-only: total presenter yang belum dihitung (NULL)
// cuma DIESTIMASI pakai logika fee yang sama (presenter-fee.util.ts),
// SENGAJA nggak manggil PaymentService.ensureCalculated — itu nulis ke
// payments + push ke ocs2, nggak boleh kepicu cuma gara-gara orang buka
// dashboard. Data skala ratusan-ribuan baris, jadi cukup findMany dengan
// select sempit lalu diagregasi di TypeScript (lebih gampang dibaca &
// dicocokkan sama aturan bisnis daripada SQL FILTER panjang).

type Segment = 'presenter' | 'participant';
type StatusBucket =
  | 'verified'
  | 'waiting for verification'
  | 'waiting for payment'
  | 'rejected'
  | 'waiting for calculation'
  | 'other';

const KNOWN_STATUSES = new Set<string>([
  'verified',
  'waiting for verification',
  'waiting for payment',
  'rejected',
  'waiting for calculation',
]);

const STATUS_ORDER: { status: StatusBucket; label: string }[] = [
  { status: 'verified', label: 'Terverifikasi' },
  { status: 'waiting for verification', label: 'Menunggu verifikasi' },
  { status: 'waiting for payment', label: 'Menunggu pembayaran' },
  { status: 'rejected', label: 'Bukti ditolak' },
  { status: 'waiting for calculation', label: 'Menunggu perhitungan' },
  { status: 'other', label: 'Status lain' },
];

const SEGMENT_LABEL: Record<Segment, string> = {
  presenter: 'Presenter',
  participant: 'Peserta',
};

// 'rejected' BUKAN pembatalan — tagihannya tetap berdiri (peserta bisa
// upload ulang), jadi masuk outstanding, bukan dikeluarkan dari tagihan.
const OUTSTANDING_BUCKETS = new Set<StatusBucket>(['waiting for payment', 'rejected', 'waiting for calculation']);

type Bill = {
  kind: Segment;
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  // null = nominal nggak diketahui (presenter belum dihitung & nggak bisa
  // diestimasi). Sudah termasuk estimasi kalau estimated = true.
  amount: number | null;
  estimated: boolean;
  uncalculated: boolean;
  zeroAmount: boolean;
  rawStatus: string | null;
  bucket: StatusBucket;
  isMember: boolean;
  sentInvoice: boolean;
  since: string | null;
  proofUploadedAt: Date | null;
  paperAccepted: boolean;
  detailPath: string;
  // Pendaftaran peserta lama yang barisnya sudah ditimpa re-join (sumber:
  // audit_log 'participant_rejoin_archive'). Ikut angka uang conference
  // lamanya, tapi BUKAN tagihan yang bisa ditindaklanjuti (baris live-nya
  // sudah milik conference baru) — jadi nggak masuk daftar aksi.
  archived: boolean;
  // Rentang waktu pendaftaran ini "hidup" — buat nentuin log accept di
  // audit_log milik pendaftaran yang mana (id peserta = user id, sama
  // antara arsip & baris live). null = nggak dibatasi.
  activeFrom: Date | null;
  activeUntil: Date | null;
};

type ArchivedParticipant = {
  conferenceId: string | null;
  totalAmount: number | null;
  status: string | null;
  isMember: boolean;
  sentInvoice: boolean;
  from: Date | null;
  until: Date;
};

// Kolom payments.payment_status punya default Prisma yang rusak (string
// literal "'waiting for calculation'::character varying", kutip & cast
// ikut kesimpen) — dinormalisasi di sini biar nggak nyasar ke "lainnya".
function normalizeStatus(raw: string | null): string | null {
  if (raw == null) return null;
  let s = raw.trim().toLowerCase();
  const m = /^'(.*)'::character varying$/.exec(s);
  if (m) s = m[1].trim();
  return s || null;
}

function bucketOf(status: string | null): StatusBucket {
  // NULL (data legacy) diperlakukan sama kayak belum bayar.
  if (status == null) return 'waiting for payment';
  return KNOWN_STATUSES.has(status) ? (status as StatusBucket) : 'other';
}

// Bill yang ikut dijumlah ke angka uang: nominal diketahui, status
// dikenal, dan bukan baris peserta nominal-0 warisan bug Java lama.
function isCountable(b: Bill): boolean {
  return b.amount != null && b.bucket !== 'other' && !b.zeroAmount;
}

// ---- Minggu (Senin, Asia/Jakarta = UTC+7 tanpa DST) ----
// Kolom timestamp di DB tanpa zona waktu, dibaca Prisma sebagai UTC —
// digeser +7 jam dulu biar batas minggunya ikut kalender WIB.
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function jakartaDateKey(d: Date): string {
  return new Date(d.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

function weekStartKey(d: Date): string {
  const local = new Date(d.getTime() + JAKARTA_OFFSET_MS);
  const diff = (local.getUTCDay() + 6) % 7; // Senin = 0
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - diff))
    .toISOString()
    .slice(0, 10);
}

function addWeeks(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

// Daftar minggu dari..sampai (inklusif), minggu yang kosong tetap muncul
// dengan nilai 0 biar chart nggak "loncat".
function weekRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addWeeks(k, 1)) out.push(k);
  return out;
}

// Normalisasi teks bebas (afiliasi/negara/tipe): key = huruf kecil +
// spasi dirapikan, label = varian tulisan asli yang paling sering muncul.
class TextTally {
  private map = new Map<string, { count: number; variants: Map<string, number> }>();

  add(raw: string | null | undefined, fallback?: string) {
    const clean = (raw ?? '').replace(/\s+/g, ' ').trim();
    const label = clean || fallback;
    if (!label) return;
    const key = label.toLowerCase();
    const cur = this.map.get(key) ?? { count: 0, variants: new Map<string, number>() };
    cur.count++;
    cur.variants.set(label, (cur.variants.get(label) ?? 0) + 1);
    this.map.set(key, cur);
  }

  top(limit?: number): { label: string; count: number }[] {
    const rows = [...this.map.values()].map((v) => {
      const label = [...v.variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { label, count: v.count };
    });
    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return limit ? rows.slice(0, limit) : rows;
  }
}

function fullName(u: { first_name: string; last_name: string } | null | undefined): string {
  return u ? `${u.first_name} ${u.last_name}`.trim() : '';
}

// Paper "Waiting" = belum ada keputusan. Data legacy bisa NULL, jadi
// pakai "bukan Accepted/Rejected", bukan cocok persis ke 'Waiting'.
function isDecided(status: string | null): boolean {
  return status === 'Accepted' || status === 'Rejected';
}
const WAITING_PAPER_WHERE = {
  OR: [{ conference_status: null }, { conference_status: { notIn: ['Accepted', 'Rejected'] } }],
};

@Injectable()
export class StatsService {
  constructor(
    private prisma: PrismaService,
    private conferenceService: ConferenceService,
  ) {}

  private async conferenceInfo(conferenceId?: string) {
    if (!conferenceId) return null;
    const conf = await this.prisma.conference.findUnique({
      where: { conference_id: conferenceId },
      select: { conference_id: true, conference_name: true },
    });
    if (!conf) throw new NotFoundException('Conference tidak ditemukan');
    return { id: conf.conference_id, name: conf.conference_name };
  }

  // conferenceIds undefined = semua conference.
  private async loadBills(conferenceIds?: string[]): Promise<Bill[]> {
    const paperConf = conferenceIds ? { conference_id: { in: conferenceIds } } : {};
    const [payments, participants, archiveLogs] = await Promise.all([
      this.prisma.payments.findMany({
        where: {
          paper_id: { not: null },
          papers: { is: paperConf },
          // Paper yang sudah nggak Accepted (ditolak/dibatalkan setelah
          // accept) barisnya tetap ada (trigger cuma insert) — cuma
          // dihitung kalau memang sudah terlanjur dibayar & diverifikasi.
          OR: [{ papers: { is: { conference_status: 'Accepted' } } }, { payment_status: 'verified' }],
        },
        select: {
          payment_id: true,
          total_amount: true,
          payment_status: true,
          sent_invoice: true,
          users: { select: { first_name: true, last_name: true, email: true, phone: true } },
          payment_proofs: { select: { upload_date: true } },
          papers: {
            select: {
              paper_title: true,
              conference_status: true,
              accepted_at: true,
              submitter_id: true,
              users: { select: { first_name: true, last_name: true, email: true, phone: true } },
              paper_writers: {
                where: { role: 'presenter' },
                select: {
                  writer_id: true,
                  user_id: true,
                  email: true,
                  member_status: true,
                  payment_override: true,
                  manual_fee: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.participant.findMany({
        where: conferenceIds ? { conference_id: { in: conferenceIds } } : {},
        select: {
          attendance_id: true,
          conference_id: true,
          total_amount: true,
          payment_status: true,
          is_member: true,
          sent_invoice: true,
          users: { select: { first_name: true, last_name: true, email: true, phone: true } },
        },
      }),
      // Baris participant cuma 1 per user — re-join ke conference baru
      // nimpa baris itu, data lamanya cuma tersisa di arsip ini. Diambil
      // semua (conference_id-nya di dalam JSON, difilter di bawah) karena
      // waktu arsip juga dipakai buat batas window baris live.
      this.prisma.audit_log.findMany({
        where: { entity: 'participant', action: 'participant_rejoin_archive' },
        orderBy: { created_at: 'asc' },
        select: { entity_id: true, detail: true, created_at: true },
      }),
    ]);

    const archivesByUser = new Map<string, ArchivedParticipant[]>();
    for (const log of archiveLogs) {
      if (!log.entity_id || !log.detail) continue;
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(log.detail) as Record<string, unknown>;
      } catch {
        continue;
      }
      const reg: ArchivedParticipant = {
        conferenceId: typeof d.conference_id === 'string' ? d.conference_id : null,
        totalAmount: d.total_amount != null && Number.isFinite(Number(d.total_amount)) ? Number(d.total_amount) : null,
        status: typeof d.payment_status === 'string' ? d.payment_status : null,
        isMember: d.is_member === true,
        sentInvoice: d.sent_invoice === true,
        from: null,
        until: log.created_at,
      };
      const list = archivesByUser.get(log.entity_id) ?? [];
      const prev = list[list.length - 1];
      if (prev && prev.conferenceId === reg.conferenceId) {
        // Arsip dobel buat conference yang sama (re-join diulang setelah
        // update-nya gagal) = pendaftaran yang sama; pakai salinan terbaru.
        list[list.length - 1] = { ...reg, from: prev.from };
      } else {
        reg.from = prev ? prev.until : null;
        list.push(reg);
      }
      archivesByUser.set(log.entity_id, list);
    }
    // Arsip terakhir yang conference-nya masih sama dengan baris live =
    // re-join yang update-nya gagal setelah arsip ketulis; baris live itu
    // sendiri pendaftaran yang sama, jadi arsipnya dibuang biar nggak dobel.
    for (const p of participants) {
      const list = archivesByUser.get(p.attendance_id);
      const last = list?.[list.length - 1];
      if (list && last && last.conferenceId === p.conference_id) list.pop();
    }

    const bills: Bill[] = [];
    for (const pay of payments) {
      const paper = pay.papers;
      if (!paper) continue;
      // Nama/kontak = akun submitter paper (fallback ke submitter di
      // baris payments kalau akun submitter papernya hilang).
      const user = paper.users ?? pay.users;
      const submitterWriter = matchSubmitterWriter(paper.paper_writers, paper.submitter_id, paper.users?.email);
      const uncalculated = pay.total_amount == null;
      const amount = uncalculated
        ? computePresenterTotal(paper.paper_writers, submitterWriter)
        : Number(pay.total_amount);
      const status = normalizeStatus(pay.payment_status);
      const proofDates = pay.payment_proofs
        .map((p) => p.upload_date)
        .filter((d): d is Date => d != null)
        .sort((a, b) => b.getTime() - a.getTime());
      bills.push({
        kind: 'presenter',
        id: pay.payment_id,
        name: fullName(user),
        email: user?.email ?? '',
        phone: user?.phone || null,
        title: paper.paper_title,
        amount,
        estimated: uncalculated && amount != null,
        uncalculated,
        zeroAmount: false,
        rawStatus: pay.payment_status,
        bucket: bucketOf(status),
        isMember: submitterWriter?.member_status === true,
        sentInvoice: pay.sent_invoice,
        since: paper.accepted_at ? paper.accepted_at.toISOString() : null,
        // Bukti terbaru = yang lagi nunggu diverifikasi (re-upload nambah baris).
        proofUploadedAt: proofDates[0] ?? null,
        paperAccepted: paper.conference_status === 'Accepted',
        detailPath: `/payment/manage/${pay.payment_id}`,
        archived: false,
        activeFrom: null,
        activeUntil: null,
      });
    }

    for (const p of participants) {
      const pastRegs = archivesByUser.get(p.attendance_id);
      const status = normalizeStatus(p.payment_status);
      const raw = p.total_amount != null ? Number(p.total_amount) : null;
      const bucket = bucketOf(status);
      // total_amount 0/NULL di peserta = bug joinConference Java lama
      // (bukan waiver kayak presenter) — dikeluarkan dari angka uang,
      // dilaporkan terpisah sebagai "perlu dicek". Yang sudah verified
      // tetap dihitung (nominal apa adanya) biar jumlah lunas nggak hilang.
      const zeroAmount = (raw == null || raw === 0) && bucket !== 'verified';
      bills.push({
        kind: 'participant',
        id: p.attendance_id,
        name: fullName(p.users),
        email: p.users?.email ?? '',
        phone: p.users?.phone || null,
        title: null,
        amount: raw ?? 0,
        estimated: false,
        uncalculated: false,
        zeroAmount,
        rawStatus: p.payment_status,
        bucket,
        isMember: p.is_member === true,
        sentInvoice: p.sent_invoice === true,
        since: null,
        proofUploadedAt: null, // peserta nggak punya kolom waktu upload bukti
        paperAccepted: false,
        detailPath: `/payment/manage/participant/${p.attendance_id}`,
        archived: false,
        // Log accept sebelum arsip terakhir milik pendaftaran lama.
        activeFrom: pastRegs?.length ? pastRegs[pastRegs.length - 1].until : null,
        activeUntil: null,
      });
    }

    for (const [userId, regs] of archivesByUser) {
      for (const a of regs) {
        if (conferenceIds && (!a.conferenceId || !conferenceIds.includes(a.conferenceId))) continue;
        const status = normalizeStatus(a.status);
        const bucket = bucketOf(status);
        bills.push({
          kind: 'participant',
          id: userId,
          // Nggak pernah tampil di daftar aksi, jadi nama/kontak nggak perlu.
          name: '',
          email: '',
          phone: null,
          title: null,
          amount: a.totalAmount ?? 0,
          estimated: false,
          uncalculated: false,
          // Aturan nominal 0/NULL sama persis kayak baris live di atas.
          zeroAmount: (a.totalAmount == null || a.totalAmount === 0) && bucket !== 'verified',
          rawStatus: a.status,
          bucket,
          isMember: a.isMember,
          sentInvoice: a.sentInvoice,
          since: null,
          proofUploadedAt: null,
          paperAccepted: false,
          detailPath: '',
          archived: true,
          activeFrom: a.from,
          activeUntil: a.until,
        });
      }
    }
    return bills;
  }

  // Yang bener-bener perlu ditagih: outstanding dengan nominal > 0
  // (presenter total 0 = waiver sah, nggak ada yang perlu dikejar).
  private unpaidBills(bills: Bill[]): Bill[] {
    return bills.filter(
      (b) => !b.archived && isCountable(b) && OUTSTANDING_BUCKETS.has(b.bucket) && (b.amount ?? 0) > 0,
    );
  }

  async finance(conferenceId?: string) {
    const conference = await this.conferenceInfo(conferenceId);
    const bills = await this.loadBills(conferenceId ? [conferenceId] : undefined);
    const countable = bills.filter(isCountable);

    const sumOf = (rows: Bill[]) => rows.reduce((s, b) => s + (b.amount ?? 0), 0);
    const collectedRows = countable.filter((b) => b.bucket === 'verified');
    const awaitingRows = countable.filter((b) => b.bucket === 'waiting for verification');
    const outstandingRows = countable.filter((b) => OUTSTANDING_BUCKETS.has(b.bucket));
    const billed = sumOf(countable);
    const collected = sumOf(collectedRows);

    const totals = {
      billed,
      collected,
      awaitingVerification: sumOf(awaitingRows),
      outstanding: sumOf(outstandingRows),
      billedCount: countable.length,
      collectedCount: collectedRows.length,
      awaitingCount: awaitingRows.length,
      outstandingCount: outstandingRows.length,
      uncalculatedCount: bills.filter((b) => b.uncalculated).length,
      uncalculatedEstimate: sumOf(countable.filter((b) => b.estimated)),
      zeroAmountCount: bills.filter((b) => b.zeroAmount).length,
      otherStatusCount: bills.filter((b) => b.bucket === 'other').length,
      collectionRate: billed > 0 ? collected / billed : 0,
    };

    const segments = (['presenter', 'participant'] as Segment[]).map((key) => {
      const rows = countable.filter((b) => b.kind === key);
      const verified = rows.filter((b) => b.bucket === 'verified');
      return {
        key,
        label: SEGMENT_LABEL[key],
        billed: sumOf(rows),
        collected: sumOf(verified),
        awaitingVerification: sumOf(rows.filter((b) => b.bucket === 'waiting for verification')),
        outstanding: sumOf(rows.filter((b) => OUTSTANDING_BUCKETS.has(b.bucket))),
        count: rows.length,
        collectedCount: verified.length,
      };
    });

    // Baris status lain ikut ditampilkan di breakdown (biar kelihatan ada
    // data aneh), tapi nggak masuk total uang di atas.
    const breakdownRows = bills.filter((b) => isCountable(b) || b.bucket === 'other');
    const statusBreakdown = STATUS_ORDER.map(({ status, label }) => {
      const rows = breakdownRows.filter((b) => b.bucket === status);
      const pres = rows.filter((b) => b.kind === 'presenter');
      const part = rows.filter((b) => b.kind === 'participant');
      return {
        status,
        label,
        presenterCount: pres.length,
        participantCount: part.length,
        presenterAmount: sumOf(pres),
        participantAmount: sumOf(part),
      };
    });

    const membership = (['presenter', 'participant'] as Segment[]).map((segment) => {
      const rows = countable.filter((b) => b.kind === segment);
      const group = (member: boolean) => {
        const g = rows.filter((b) => b.isMember === member);
        return {
          count: g.length,
          billed: sumOf(g),
          collected: sumOf(g.filter((b) => b.bucket === 'verified')),
        };
      };
      return { segment, member: group(true), nonMember: group(false) };
    });

    const weeklyVerified = await this.weeklyVerified(countable.filter((b) => b.bucket === 'verified'));

    const awaitingVerification = bills
      // Semua yang statusnya nunggu verifikasi tetap ditampilkan (ada aksi
      // yang perlu diambil admin), termasuk yang nominalnya perlu dicek.
      // Arsip re-join dikecualikan: buktinya sudah nggak bisa diverifikasi.
      .filter((b) => !b.archived && b.bucket === 'waiting for verification')
      .sort((a, b) => {
        if (!a.proofUploadedAt && !b.proofUploadedAt) return 0;
        if (!a.proofUploadedAt) return 1;
        if (!b.proofUploadedAt) return -1;
        return a.proofUploadedAt.getTime() - b.proofUploadedAt.getTime();
      })
      .map((b) => ({
        kind: b.kind,
        id: b.id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        title: b.title,
        amount: b.amount ?? 0,
        proofUploadedAt: b.proofUploadedAt ? b.proofUploadedAt.toISOString() : null,
        detailPath: b.detailPath,
      }));

    const unpaid = this.unpaidBills(bills)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .map((b) => ({
        kind: b.kind,
        id: b.id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        title: b.title,
        amount: b.amount ?? 0,
        // Status dinormalisasi (trim/lowercase, default Prisma rusak) biar FE
        // bisa nyocokin label-nya — bucket & total juga pakai versi ini.
        status: normalizeStatus(b.rawStatus),
        sentInvoice: b.sentInvoice,
        since: b.since,
        detailPath: b.detailPath,
      }));

    return {
      conference,
      generatedAt: new Date().toISOString(),
      totals,
      segments,
      statusBreakdown,
      membership,
      weeklyVerified,
      awaitingVerification,
      unpaid,
      nonAcceptedVerifiedCount: bills.filter(
        (b) => b.kind === 'presenter' && b.bucket === 'verified' && !b.paperAccepted,
      ).length,
    };
  }

  // Waktu verifikasi cuma ada di audit_log (aksi di newocs; verifikasi
  // era ocs2 nggak punya jejak waktu sama sekali). entity_id VARCHAR:
  // payments -> payment_id, participant -> attendance_id. Kalau satu
  // tagihan di-accept berkali-kali (bolak-balik reject/accept), cuma
  // accept TERAKHIR yang dihitung. Nominal = nominal tagihan sekarang.
  // Peserta yang re-join punya beberapa Bill dengan id sama (arsip + live)
  // — log accept dipasangkan ke Bill yang window waktunya memuat log itu.
  private async weeklyVerified(verifiedBills: Bill[]) {
    if (verifiedBills.length === 0) return [];
    const byKey = new Map<string, Bill[]>();
    for (const b of verifiedBills) {
      const key = `${b.kind}:${b.id}`;
      byKey.set(key, [...(byKey.get(key) ?? []), b]);
    }

    const logs = await this.prisma.audit_log.findMany({
      where: {
        OR: [
          { entity: 'payments', action: 'payment_accept' },
          { entity: 'participant', action: 'payment_participant_accept' },
        ],
      },
      select: { entity: true, entity_id: true, created_at: true },
    });
    const latest = new Map<Bill, Date>();
    for (const log of logs) {
      if (!log.entity_id) continue;
      const key = `${log.entity === 'payments' ? 'presenter' : 'participant'}:${log.entity_id}`;
      const at = log.created_at;
      const bill = byKey
        .get(key)
        ?.find((b) => (!b.activeFrom || at > b.activeFrom) && (!b.activeUntil || at <= b.activeUntil));
      if (!bill) continue;
      const prev = latest.get(bill);
      if (!prev || at > prev) latest.set(bill, at);
    }
    if (latest.size === 0) return [];

    const buckets = new Map<string, { count: number; amount: number }>();
    for (const [bill, at] of latest) {
      const wk = weekStartKey(at);
      const cur = buckets.get(wk) ?? { count: 0, amount: 0 };
      cur.count++;
      cur.amount += bill.amount ?? 0;
      buckets.set(wk, cur);
    }
    const first = [...buckets.keys()].sort()[0];
    const current = weekStartKey(new Date());
    return weekRange(first, current > first ? current : first).map((weekStart) => ({
      weekStart,
      count: buckets.get(weekStart)?.count ?? 0,
      amount: buckets.get(weekStart)?.amount ?? 0,
    }));
  }

  // Statistik agregat — SENGAJA tanpa nama/email/PII (role Manager juga
  // bisa lihat ini, beda sama dashboard keuangan).
  async overview(conferenceId?: string) {
    const conference = await this.conferenceInfo(conferenceId);
    const confWhere = conferenceId ? { conference_id: conferenceId } : {};
    const paperRel = conferenceId ? { papers: { conference_id: conferenceId } } : {};

    const [papers, messages, acceptedWriters, participants, attendance, roleGroups] = await Promise.all([
      this.prisma.papers.findMany({
        where: confWhere,
        select: {
          paper_id: true,
          conference_status: true,
          sent_loa: true,
          sub_theme: true,
          type: true,
          upload_date: true,
          submitter_id: true,
          paper_reviewer: { select: { deadline: true } },
        },
      }),
      this.prisma.paper_feedback_messages.findMany({
        where: paperRel,
        orderBy: { created_at: 'asc' },
        select: { paper_id: true, side: true },
      }),
      this.prisma.paper_writers.findMany({
        where: { papers: { ...confWhere, conference_status: 'Accepted' } },
        select: { email: true, member_status: true, affiliation: true },
      }),
      this.prisma.participant.findMany({
        where: confWhere,
        select: { attendance_id: true, is_member: true, users: { select: { affiliation: true, country: true } } },
      }),
      this.prisma.attendance.findMany({
        where: confWhere,
        select: { writer_id: true, participant_id: true, presence: true, sent_ecertificate: true },
      }),
      this.prisma.users.groupBy({ by: ['role'], _count: { _all: true } }),
    ]);

    // ---- Paper ----
    const today = jakartaDateKey(new Date());
    let accepted = 0;
    let rejected = 0;
    let waiting = 0;
    let loaSent = 0;
    let unassignedWaiting = 0;
    let overdueAssignments = 0;
    const subThemes = new Map<string, { accepted: number; rejected: number; waiting: number }>();
    const types = new TextTally();
    const paperWeeks = new Map<string, number>();
    for (const p of papers) {
      const st = p.conference_status === 'Accepted' ? 'accepted' : p.conference_status === 'Rejected' ? 'rejected' : 'waiting';
      if (st === 'accepted') accepted++;
      else if (st === 'rejected') rejected++;
      else waiting++;
      if (p.sent_loa) loaSent++;
      if (!isDecided(p.conference_status)) {
        if (p.paper_reviewer.length === 0) unassignedWaiting++;
        // deadline kolom DATE (dibaca UTC tengah malam) — dibandingkan
        // sebagai YYYY-MM-DD sama tanggal hari ini versi WIB.
        overdueAssignments += p.paper_reviewer.filter((r) => r.deadline.toISOString().slice(0, 10) < today).length;
      }
      const themeKey = p.sub_theme?.trim() || 'Tanpa sub tema';
      const theme = subThemes.get(themeKey) ?? { accepted: 0, rejected: 0, waiting: 0 };
      theme[st]++;
      subThemes.set(themeKey, theme);
      types.add(p.type, 'Tidak diisi');
      if (p.upload_date) {
        const wk = weekStartKey(p.upload_date);
        paperWeeks.set(wk, (paperWeeks.get(wk) ?? 0) + 1);
      }
    }
    const bySubTheme = [...subThemes.entries()]
      .map(([subTheme, v]) => ({ subTheme, ...v }))
      .sort(
        (a, b) =>
          b.accepted + b.rejected + b.waiting - (a.accepted + a.rejected + a.waiting) ||
          a.subTheme.localeCompare(b.subTheme),
      );

    const lastSide = new Map<string, string>();
    for (const m of messages) lastSide.set(m.paper_id, m.side);
    const feedbackAwaitingReply = [...lastSide.values()].filter((s) => s === 'author').length;

    // Minggu paper: dari upload pertama sampai upload terakhir di scope.
    const paperWeekKeys = [...paperWeeks.keys()].sort();
    const weeklyPapers = paperWeekKeys.length
      ? weekRange(paperWeekKeys[0], paperWeekKeys[paperWeekKeys.length - 1]).map((weekStart) => ({
          weekStart,
          count: paperWeeks.get(weekStart) ?? 0,
        }))
      : [];

    // Akun baru: global (akun nggak terikat conference), 26 minggu terakhir.
    const currentWeek = weekStartKey(new Date());
    const firstAccountWeek = addWeeks(currentWeek, -25);
    const recentUsers = await this.prisma.users.findMany({
      where: { created_at: { gte: new Date(Date.parse(`${firstAccountWeek}T00:00:00Z`) - JAKARTA_OFFSET_MS) } },
      select: { created_at: true },
    });
    const accountWeeks = new Map<string, number>();
    for (const u of recentUsers) {
      if (!u.created_at) continue;
      const wk = weekStartKey(u.created_at);
      accountWeeks.set(wk, (accountWeeks.get(wk) ?? 0) + 1);
    }
    const weeklyAccounts = weekRange(firstAccountWeek, currentWeek).map((weekStart) => ({
      weekStart,
      count: accountWeeks.get(weekStart) ?? 0,
    }));

    // ---- Orang ----
    // Presenter = penulis di paper Accepted, unik per email (satu orang
    // bisa nulis beberapa paper).
    const presenterByEmail = new Map<string, { member: boolean; affiliation: string }>();
    for (const w of acceptedWriters) {
      const key = w.email.trim().toLowerCase();
      if (!key) continue;
      const cur = presenterByEmail.get(key) ?? { member: false, affiliation: '' };
      if (w.member_status) cur.member = true;
      if (!cur.affiliation && w.affiliation?.trim()) cur.affiliation = w.affiliation;
      presenterByEmail.set(key, cur);
    }
    const affiliations = new TextTally();
    for (const p of presenterByEmail.values()) affiliations.add(p.affiliation);
    for (const p of participants) affiliations.add(p.users?.affiliation);

    // Negara: peserta + submitter paper Accepted, unik per akun.
    const countryByUser = new Map<string, string | null>();
    for (const p of participants) countryByUser.set(p.attendance_id, p.users?.country ?? null);
    const submitterIds = [
      ...new Set(
        papers
          .filter((p) => p.conference_status === 'Accepted' && p.submitter_id)
          .map((p) => p.submitter_id as string)
          .filter((id) => !countryByUser.has(id)),
      ),
    ];
    if (submitterIds.length) {
      const submitters = await this.prisma.users.findMany({
        where: { user_id: { in: submitterIds } },
        select: { user_id: true, country: true },
      });
      for (const u of submitters) countryByUser.set(u.user_id, u.country);
    }
    const countries = new TextTally();
    for (const c of countryByUser.values()) countries.add(c, 'Tidak diisi');

    const accountsByRole = roleGroups
      .map((g) => ({ role: g.role, count: g._count._all }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

    return {
      conference,
      generatedAt: new Date().toISOString(),
      papers: {
        total: papers.length,
        accepted,
        rejected,
        waiting,
        loaSent,
        bySubTheme,
        byType: types.top().map((t) => ({ type: t.label, count: t.count })),
      },
      review: { unassignedWaiting, overdueAssignments, feedbackAwaitingReply },
      weekly: { papers: weeklyPapers, accounts: weeklyAccounts },
      people: {
        presenters: presenterByEmail.size,
        participants: participants.length,
        presenterMembers: [...presenterByEmail.values()].filter((p) => p.member).length,
        participantMembers: participants.filter((p) => p.is_member === true).length,
        topAffiliations: affiliations.top(10).map((a) => ({ affiliation: a.label, count: a.count })),
        countries: countries.top(10).map((c) => ({ country: c.label, count: c.count })),
      },
      attendance: {
        presenterTotal: attendance.filter((a) => a.writer_id != null).length,
        presenterPresent: attendance.filter((a) => a.writer_id != null && a.presence).length,
        participantTotal: attendance.filter((a) => a.participant_id != null).length,
        participantPresent: attendance.filter((a) => a.participant_id != null && a.presence).length,
        certificatesSent: attendance.filter((a) => a.sent_ecertificate).length,
      },
      accounts: {
        total: accountsByRole.reduce((s, r) => s + r.count, 0),
        byRole: accountsByRole,
      },
    };
  }

  // Ringkasan "perlu ditindaklanjuti" buat halaman /dashboard — cuma
  // angka, scope conference AKTIF. Item cuma muncul kalau role pemanggil
  // punya permission-nya (dicek ke role_permissions, sama kayak
  // PermissionsGuard) — jadi endpoint ini cukup JWT, tanpa permission khusus.
  async summary(role: string | undefined) {
    const grants = role
      ? await this.prisma.role_permissions.findMany({
          where: { roles: { name: role } },
          select: { module: true, action: true },
        })
      : [];
    const has = (module: string, action: string) => grants.some((g) => g.module === module && g.action === action);

    const canVerify = has('payment', 'verify');
    const canReview = has('papers', 'review');
    const canAssign = has('assign_reviewer', 'manage');
    const canFinance = has('report', 'finance_dashboard');
    const items: { key: string; label: string; count: number; path: string }[] = [];
    if (!canVerify && !canReview && !canAssign && !canFinance) return { items };

    const active = await this.conferenceService.findActive();
    const ids = active.map((c) => c.conference_id);

    if (canVerify) {
      // Sama kayak halaman Kelola Pembayaran: semua payment paper di
      // conference itu (tanpa syarat Accepted) + peserta.
      const [team, part] = await Promise.all([
        this.prisma.payments.count({
          where: { payment_status: 'waiting for verification', papers: { conference_id: { in: ids } } },
        }),
        this.prisma.participant.count({
          where: { payment_status: 'waiting for verification', conference_id: { in: ids } },
        }),
      ]);
      items.push({
        key: 'proofs_awaiting',
        label: 'Bukti transfer menunggu verifikasi',
        count: team + part,
        path: '/payment/manage',
      });
    }

    if (canReview) {
      const [waitingCount, messages] = await Promise.all([
        this.prisma.papers.count({ where: { conference_id: { in: ids }, ...WAITING_PAPER_WHERE } }),
        this.prisma.paper_feedback_messages.findMany({
          where: { papers: { conference_id: { in: ids } } },
          orderBy: { created_at: 'asc' },
          select: { paper_id: true, side: true },
        }),
      ]);
      const lastSide = new Map<string, string>();
      for (const m of messages) lastSide.set(m.paper_id, m.side);
      items.push({ key: 'papers_waiting', label: 'Paper menunggu keputusan', count: waitingCount, path: '/papers/review' });
      items.push({
        key: 'author_replies',
        label: 'Balasan penulis belum dijawab',
        count: [...lastSide.values()].filter((s) => s === 'author').length,
        path: '/papers/review',
      });
    }

    if (canAssign) {
      const count = await this.prisma.papers.count({
        where: { conference_id: { in: ids }, ...WAITING_PAPER_WHERE, paper_reviewer: { none: {} } },
      });
      items.push({ key: 'papers_unassigned', label: 'Paper belum punya reviewer', count, path: '/papers/assign-reviewer' });
    }

    if (canFinance) {
      const bills = ids.length ? await this.loadBills(ids) : [];
      items.push({ key: 'unpaid', label: 'Tagihan belum dibayar', count: this.unpaidBills(bills).length, path: '/finance' });
    }

    return { items };
  }
}
