// Field ini niru writer di CreatePaperWriterRequestDTO (Java lama) —
// divalidasi manual di papers.service.ts, bukan lewat class-validator,
// karena datangnya dari field JSON string di multipart/form-data
// (lihat submit-paper.dto.ts).
export interface AuthorInput {
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  affiliation: string;
  email: string;
  phoneNumber: string;
  statusMember?: boolean;
}
