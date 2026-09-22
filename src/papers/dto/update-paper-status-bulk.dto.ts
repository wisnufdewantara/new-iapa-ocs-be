import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

export class UpdatePaperStatusBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  paperIds: string[];

  @IsIn(['Accepted', 'Rejected'])
  conferenceStatus: 'Accepted' | 'Rejected';
}
