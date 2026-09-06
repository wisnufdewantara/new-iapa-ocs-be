// Status ditentukan manual oleh admin/manager di halaman Conference,
// bukan dihitung otomatis dari tanggal — biar admin bisa override
// (misal nutup pendaftaran lebih awal atau perpanjang "coming soon").
export const CONFERENCE_STATUSES = ['coming_soon', 'ongoing', 'ended'] as const;
export type ConferenceStatus = (typeof CONFERENCE_STATUSES)[number];
