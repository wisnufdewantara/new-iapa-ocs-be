import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FONT_KEYS } from '../certificate-fonts.constant';

class PlaceholderDto {
  @IsInt()
  @Min(1)
  @Max(10)
  slot: number;

  // 'name'/'cert_type' ngerender otomatis dari data recipient (content
  // diabaikan backend); 'custom' ngerender dari content (boleh {{variabel}}).
  @IsIn(['name', 'cert_type', 'custom'])
  type: 'name' | 'cert_type' | 'custom';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  content?: string;

  @IsIn(FONT_KEYS)
  fontKey: string;

  @IsNumber()
  @Min(0.01)
  @Max(0.1)
  fontSize: number;

  @Matches(/^#[0-9a-fA-F]{6}$/)
  color: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  posX: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  posY: number;

  @IsNumber()
  @Min(0.1)
  @Max(1)
  maxWidth: number;
}

class SignerDto {
  @IsInt()
  @Min(1)
  @Max(3)
  slot: number;

  @IsString()
  @MaxLength(255)
  signerName: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  signerTitle?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  posX: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  posY: number;

  @IsNumber()
  @Min(0.05)
  @Max(0.35)
  width: number;
}

// Semua field opsional — PATCH ini nyimpen apa pun yang draft editor FE
// pegang sekali jalan (bukan incremental per-field), jadi FE selalu
// ngirim object lengkap, tapi backend tetap toleran kalau cuma sebagian.
export class UpdateCertificateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(FONT_KEYS)
  bodyFontKey?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(0.06)
  signerFontSize?: number;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  signerColor?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SignerDto)
  @ArrayMaxSize(3)
  signers?: SignerDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PlaceholderDto)
  @ArrayMaxSize(10)
  placeholders?: PlaceholderDto[];

  @IsOptional()
  @IsBoolean()
  page2Enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  page2Title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  page2Content?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  page2TotalJp?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(0.06)
  page2FontSize?: number;

  @IsOptional()
  @IsBoolean()
  qrEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  qrPosX?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  qrPosY?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.04)
  @Max(0.25)
  qrSize?: number;
}
