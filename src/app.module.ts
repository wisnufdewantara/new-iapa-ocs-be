import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConferenceModule } from './conference/conference.module';

@Module({
  imports: [PrismaModule, AuthModule, ConferenceModule],
})
export class AppModule {}
