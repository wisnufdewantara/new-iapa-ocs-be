import { Body, Controller, Get, Post } from '@nestjs/common';
import { FunctionalTestService } from './functional-test.service';
import { UpsertFunctionalTestResultDto } from './dto/upsert-result.dto';

// /api/functional-test/** — SENGAJA publik (tanpa JwtAuthGuard), penguji
// UAT belum tentu punya akun newocs. Satu-satunya kontrol akses adalah
// toggle enabled/disabled yang cuma admin bisa ubah (lihat
// DeveloperController) — kalau disabled, service ini nolak semua read/write.
@Controller('api/functional-test')
export class FunctionalTestController {
  constructor(private functionalTestService: FunctionalTestService) {}

  @Get('status')
  status() {
    return this.functionalTestService.isEnabled().then((enabled) => ({ enabled }));
  }

  @Get('results')
  results() {
    return this.functionalTestService.listResults();
  }

  @Post('results')
  upsert(@Body() dto: UpsertFunctionalTestResultDto) {
    return this.functionalTestService.upsertResult(dto);
  }
}
