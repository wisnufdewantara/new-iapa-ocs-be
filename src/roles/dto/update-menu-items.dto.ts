import { IsArray, IsIn, IsString } from 'class-validator';
import { MENU_KEYS } from '../menu-items.constant';

export class UpdateMenuItemsDto {
  @IsArray()
  @IsString({ each: true })
  @IsIn(MENU_KEYS, { each: true })
  menuKeys: string[];
}
