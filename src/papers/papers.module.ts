import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceModule } from '../conference/conference.module';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [AuthModule, ConferenceModule],
  controllers: [PapersController],
  providers: [PapersService],
})
export class PapersModule {}
