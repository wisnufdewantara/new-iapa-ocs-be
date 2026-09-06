import { IsIn } from 'class-validator';

export class UpdatePaperStatusDto {
  @IsIn(['Waiting', 'Accepted', 'Rejected'])
  conferenceStatus: 'Waiting' | 'Accepted' | 'Rejected';
}
