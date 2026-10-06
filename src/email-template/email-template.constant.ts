// Konten default 4 email notifikasi yang dikirim newocs. Kalau admin
// belum pernah nyimpen override buat satu key, ini yang dipakai — jadi
// baris di tabel email_template CUMA ada kalau udah pernah diedit.
// Variabel diisi via {{nama}}, di-interpolate polos (no HTML escaping —
// isinya trusted, dikontrol admin doang, bukan dari input publik).
export interface EmailTemplateDefault {
  key: string;
  label: string;
  subject: string;
  bodyHtml: string;
  variables: string[];
}

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateDefault[] = [
  {
    key: 'loa',
    label: 'Letter of Acceptance (LoA)',
    subject: 'Letter of Acceptance — IAPA Conference',
    bodyHtml: '<p>Dear {{firstName}},</p><p>Terlampir Letter of Acceptance untuk paper Anda: <strong>{{paperTitle}}</strong>.</p>',
    variables: ['firstName', 'paperTitle'],
  },
  {
    key: 'certificate',
    label: 'Sertifikat (Presenter/Peserta)',
    subject: 'Sertifikat {{type}} — IAPA Conference',
    bodyHtml: '<p>Dear {{name}},</p><p>Terlampir e-sertifikat Anda sebagai <strong>{{type}}</strong>.</p>',
    variables: ['name', 'type'],
  },
  {
    key: 'certificate_award',
    label: 'Sertifikat Award (Best Paper / Best Presenter)',
    subject: 'Sertifikat {{awardLabel}} — IAPA Conference',
    bodyHtml: '<p>Dear {{firstName}},</p><p>Selamat! Terlampir e-sertifikat {{awardLabel}} Anda.</p>',
    variables: ['firstName', 'awardLabel'],
  },
  {
    key: 'invoice',
    label: 'Invoice Pembayaran',
    subject: 'Invoice Pembayaran — IAPA Conference',
    bodyHtml: '<p>Dear {{firstName}},</p><p>Terlampir invoice pembayaran {{description}}.</p>{{deadlineBlock}}',
    variables: ['firstName', 'description', 'deadlineBlock'],
  },
  {
    key: 'receipt',
    label: 'Kwitansi Pembayaran',
    subject: 'Kwitansi Pembayaran — IAPA Conference',
    bodyHtml: '<p>Dear {{firstName}},</p><p>Terlampir kwitansi sebagai bukti bahwa pembayaran {{description}} telah kami terima dan verifikasi.</p>',
    variables: ['firstName', 'description'],
  },
  {
    key: 'password_reset',
    label: 'Reset Password',
    subject: 'Reset Password — IAPA OCS',
    bodyHtml:
      '<p>Dear {{firstName}},</p><p>Klik link berikut untuk atur ulang password Anda (berlaku 1 jam):</p><p><a href="{{resetLink}}">{{resetLink}}</a></p><p>Kalau Anda tidak meminta reset password, abaikan email ini — password Anda tetap aman.</p>',
    variables: ['firstName', 'resetLink'],
  },
];
