import { IsOptional, IsString, MaxLength } from 'class-validator';

// Dikirim sebagai multipart text field bareng file desain (lihat
// certificate-templates.controller.ts POST /).
export class CreateCertificateTemplateDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
