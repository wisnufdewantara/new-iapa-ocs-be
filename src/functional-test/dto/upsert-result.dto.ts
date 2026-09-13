import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertFunctionalTestResultDto {
  @Matches(/^TC-\d{2}$/)
  testId: string;

  @IsIn(['pending', 'pass', 'fail'])
  status: 'pending' | 'pass' | 'fail';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tester?: string;
}
