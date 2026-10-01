import { IsOptional, IsUUID } from 'class-validator';

// null = hapus mapping buat cert_type itu (balik ke default/legacy).
export class UpdateTemplateMappingsDto {
  @IsOptional()
  @IsUUID()
  participant?: string | null;

  @IsOptional()
  @IsUUID()
  presenter?: string | null;

  @IsOptional()
  @IsUUID()
  bestPaper?: string | null;

  @IsOptional()
  @IsUUID()
  bestPresenter?: string | null;
}
