import { IsIn, IsString, MinLength, ValidateIf } from 'class-validator';

export class VerifyPaymentDto {
  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';

  // Wajib diisi kalau reject — niru validasi PaymentController lama
  // (reject tanpa alasan ditolak 400). ValidateIf bikin field ini
  // dilewatin sepenuhnya kalau action='accept'.
  @ValidateIf((dto) => dto.action === 'reject')
  @IsString()
  @MinLength(1)
  reason?: string;
}
