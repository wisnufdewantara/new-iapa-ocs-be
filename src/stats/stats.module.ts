import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceModule } from '../conference/conference.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

// AuthModule wajib (JwtAuthGuard), ConferenceModule buat findActive() di
// ringkasan /summary. Logika fee presenter diambil dari util pure
// (payment/presenter-fee.util.ts), jadi nggak perlu import PaymentModule.
@Module({
  imports: [AuthModule, ConferenceModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
