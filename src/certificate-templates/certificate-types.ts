// Dipisah dari certificate.service.ts biar certificate-templates/ nggak
// perlu import balik dari modul certificate/ (hindari circular import).
export type CertificateType = 'Participant' | 'Presenter' | 'Best Paper' | 'Best Presenter';

export type CertType = 'participant' | 'presenter' | 'best_paper' | 'best_presenter';

export const CERT_TYPE_KEY: Record<CertificateType, CertType> = {
  Participant: 'participant',
  Presenter: 'presenter',
  'Best Paper': 'best_paper',
  'Best Presenter': 'best_presenter',
};
