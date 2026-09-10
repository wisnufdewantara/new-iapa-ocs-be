import { IsNumberString, Length } from 'class-validator';

export class UpdatePaymentTypeDto {
  @IsNumberString()
  @Length(1, 3)
  uniqueCode: string;
}
