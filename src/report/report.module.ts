import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { AuthModule } from '../auth/auth.module';

// PrismaModule itu @Global() — nggak perlu diimport eksplisit. AuthModule
// WAJIB ada di sini karena JwtAuthGuard butuh AuthModuleOptions dari situ
// (lupa diimport sebelumnya, bikin app gagal boot — UnknownDependenciesException).
@Module({
  imports: [AuthModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
