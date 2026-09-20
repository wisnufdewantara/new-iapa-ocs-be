import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

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
}

export class UpdateWritersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WriterUpdateDto)
  writers: WriterUpdateDto[];
}
