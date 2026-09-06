import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.app_settings.findMany({ orderBy: { setting_key: 'asc' } });
  }

  update(key: string, value: string) {
    return this.prisma.app_settings.update({
      where: { setting_key: key },
      data: { setting_value: value, updated_at: new Date() },
    });
  }
}
