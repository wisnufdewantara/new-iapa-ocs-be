import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class WriterUpdateDto {
  @IsString()
  writerId: string;

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

export class UpdateWritersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WriterUpdateDto)
  writers: WriterUpdateDto[];
}
