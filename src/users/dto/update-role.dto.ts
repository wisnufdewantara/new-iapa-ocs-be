import { IsIn } from 'class-validator';
import { Role } from '../../common/roles';

export class UpdateRoleDto {
  @IsIn(Object.values(Role))
  role: Role;
}
