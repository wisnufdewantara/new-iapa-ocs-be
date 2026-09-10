import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Validasi module/action sebagai PASANGAN yang valid (bukan cuma masing2
// string-nya) dilakukan di RolesService.setPermissions terhadap
// PERMISSION_CATALOG — class-validator nggak praktis buat validasi
// kombinasi nested kayak gini.
class PermissionEntryDto {
  @IsString()
  module: string;

  @IsString()
  action: string;
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionEntryDto)
  permissions: PermissionEntryDto[];
}
