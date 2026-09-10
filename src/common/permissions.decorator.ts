import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permission';
export const RequirePermission = (module: string, action: string) =>
  SetMetadata(PERMISSIONS_KEY, { module, action });
