import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceModule } from '../conference/conference.module';
import { ParticipantController } from './participant.controller';
import { ParticipantService } from './participant.service';

@Module({
  imports: [AuthModule, ConferenceModule],
  controllers: [ParticipantController],
  providers: [ParticipantService],
})
export class ParticipantModule {}
