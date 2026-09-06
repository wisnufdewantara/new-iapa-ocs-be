import { IsDateString, IsUUID } from 'class-validator';

export class AssignReviewerDto {
  @IsUUID()
  paperId: string;

  @IsUUID()
  reviewerId: string;

  @IsDateString()
  deadline: string;
}
