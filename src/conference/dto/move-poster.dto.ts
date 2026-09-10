import { IsIn } from 'class-validator';

export class MovePosterDto {
  @IsIn(['up', 'down'])
  direction: 'up' | 'down';
}
