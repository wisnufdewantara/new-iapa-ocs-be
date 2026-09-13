import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertFunctionalTestResultDto } from './dto/upsert-result.dto';

const SETTING_KEY = 'functional_test.enabled';

// Lembar UAT publik (/functional-test) — TIDAK dijaga login, dipakai
// penguji yang belum tentu punya akun. Aktif/nonaktif diatur admin lewat
// Developer Dashboard (lihat DeveloperController), disimpan sebagai baris
// app_settings biasa, BUKAN lewat SettingsService (katalog key di sana
// khusus System Settings, bukan tempat buat toggle fitur ini).
@Injectable()
export class FunctionalTestService {
  constructor(private prisma: PrismaService) {}

  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.app_settings.findUnique({ where: { setting_key: SETTING_KEY } });
    return row?.setting_value === 'true';
  }

  async setEnabled(enabled: boolean) {
    await this.prisma.app_settings.upsert({
      where: { setting_key: SETTING_KEY },
      create: { setting_key: SETTING_KEY, label: 'Functional Test aktif', setting_value: String(enabled), updated_at: new Date() },
      update: { setting_value: String(enabled), updated_at: new Date() },
    });
    return { enabled };
  }

  async listResults() {
    if (!(await this.isEnabled())) throw new ForbiddenException('Functional test sedang tidak aktif.');
    return this.prisma.functional_test_result.findMany({ orderBy: { test_id: 'asc' } });
  }

  async upsertResult(dto: UpsertFunctionalTestResultDto) {
    if (!(await this.isEnabled())) throw new ForbiddenException('Functional test sedang tidak aktif.');
    return this.prisma.functional_test_result.upsert({
      where: { test_id: dto.testId },
      create: { test_id: dto.testId, status: dto.status, note: dto.note, tester: dto.tester },
      update: { status: dto.status, note: dto.note, tester: dto.tester },
    });
  }
}
