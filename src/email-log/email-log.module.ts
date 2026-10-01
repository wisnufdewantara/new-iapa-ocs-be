import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailLogController } from './email-log.controller';
import { EmailTrackController } from './email-track.controller';
import { EmailLogService } from './email-log.service';
import { EmailLogCleanupService } from './email-log-cleanup.service';

@Module({
  imports: [AuthModule],
  controllers: [EmailLogController, EmailTrackController],
  providers: [EmailLogService, EmailLogCleanupService],
})
export class EmailLogModule {}
