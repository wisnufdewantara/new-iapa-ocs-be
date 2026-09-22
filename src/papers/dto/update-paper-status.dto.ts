import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdatePaperStatusDto {
  @IsIn(['Waiting', 'Accepted', 'Rejected'])
  conferenceStatus: 'Waiting' | 'Accepted' | 'Rejected';

  @IsOptional()
  @IsString()
  reviewFeedback?: string;
}
