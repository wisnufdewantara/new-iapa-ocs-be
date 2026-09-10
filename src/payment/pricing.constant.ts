// Harga hardcode, niru persis PaymentServiceImpl.calculateFee di
// CMS-IAPA-BE (Java lama) — legacy juga hardcode, bukan tabel config.
// Ganti di sini kalau user minta harga baru nanti.
export const PRESENTER_FEE = { member: 750_000, nonMember: 1_000_000 };
export const PARTICIPANT_FEE = { member: 300_000, nonMember: 500_000 };

export function presenterFee(memberStatus: boolean | null | undefined) {
  return memberStatus ? PRESENTER_FEE.member : PRESENTER_FEE.nonMember;
}

export function participantFee(isMember: boolean | null | undefined) {
  return isMember ? PARTICIPANT_FEE.member : PARTICIPANT_FEE.nonMember;
}
