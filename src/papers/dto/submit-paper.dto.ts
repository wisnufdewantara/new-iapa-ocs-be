import { IsString, MaxLength } from 'class-validator';

// Dikirim sebagai multipart/form-data bareng file dokumen — `authors`
// datang berupa string JSON (di-parse & divalidasi manual di
// papers.service.ts), karena class-validator nggak bisa transform
// nested array langsung dari field multipart yang selalu string.
export class SubmitPaperDto {
  @IsString()
  @MaxLength(255)
  paperTitle: string;

  @IsString()
  abstractText: string;

  @IsString()
  @MaxLength(255)
  keywords: string;

  @IsString()
  @MaxLength(255)
  subTheme: string;

  @IsString()
  authors: string;
}
