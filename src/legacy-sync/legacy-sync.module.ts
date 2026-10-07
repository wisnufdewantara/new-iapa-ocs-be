import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LegacySyncController } from './legacy-sync.controller';
import { LegacySyncService } from './legacy-sync.service';

@Module({
  imports: [AuthModule],
  controllers: [LegacySyncController],
  providers: [LegacySyncService],
})
export class LegacySyncModule {}
