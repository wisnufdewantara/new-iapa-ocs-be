import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceController } from './conference.controller';
import { ConferenceService } from './conference.service';

@Module({
  imports: [AuthModule],
  controllers: [ConferenceController],
  providers: [ConferenceService],
})
export class ConferenceModule {}
