import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class WriterUpdateDto {
  @IsString()
  writerId: string;

  // Ganti nama penulis — dulu read-only, sekarang bisa diedit langsung
  // dari fitur "Edit Penulis" di halaman detail pembayaran.
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsIn(['presenter', 'participant'])
  role: string;

  @IsBoolean()
  isMember: boolean;

  // null = normal, "non_payment"/"writer" = waive fee baris ini.
  @IsOptional()
  @IsIn(['non_payment', 'writer', null])
  paymentOverride: string | null;

  // Nominal custom yang di-set admin manual — SEKALI aja, service-nya
  // nolak diam-diam kalau writer ini udah punya manual_fee sebelumnya.
  @IsOptional()
  @IsNumber()
  @Min(0)
  manualFee?: number | null;
}

// Penulis baru yang ditambahin lewat "Edit Penulis" — belum punya
// writer_id (di-generate server-side).
class NewWriterDto {
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsIn(['male', 'female', 'other'])
  gender: string;

  @IsString()
  affiliation: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsIn(['presenter', 'participant'])
  role: string;

  @IsBoolean()
  isMember: boolean;
}

export class UpdateWritersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WriterUpdateDto)
  writers: WriterUpdateDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NewWriterDto)
  newWriters?: NewWriterDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deleteWriterIds?: string[];
}
