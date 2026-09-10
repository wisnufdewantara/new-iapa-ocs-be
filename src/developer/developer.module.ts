import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';

@Module({
  imports: [AuthModule],
  controllers: [DeveloperController],
  providers: [DeveloperService],
})
export class DeveloperModule {}
