// Variabel yang bisa diselipkan admin di teks placeholder manual
// (certificate_template_placeholders.content, format {{key}}) — dipakai
// juga buat hint UI di editor FE (GET /certificate-templates/placeholder-variables).
// Interpolasi dumb regex replace (sama kayak EmailTemplateService.render),
// nggak ada HTML-escaping karena ini ditulis langsung ke PDF (bukan HTML),
// dan isinya trusted (dikontrol admin, bukan input publik).
export interface PlaceholderVariableDef {
  key: string;
  label: string;
}

export const PLACEHOLDER_VARIABLES: PlaceholderVariableDef[] = [
  { key: 'name', label: 'Nama Penerima' },
  { key: 'certType', label: 'Tipe Sertifikat (mis. Presenter)' },
  { key: 'conferenceName', label: 'Nama Conference' },
  { key: 'paperTitle', label: 'Judul Paper (kosong untuk peserta)' },
  { key: 'eventDate', label: 'Tanggal (format Indonesia)' },
];

export function interpolatePlaceholder(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? '');
}
