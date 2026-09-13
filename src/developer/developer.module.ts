import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FunctionalTestModule } from '../functional-test/functional-test.module';
import { DeveloperController } from './developer.controller';
import { DeveloperService } from './developer.service';

@Module({
  imports: [AuthModule, FunctionalTestModule],
  controllers: [DeveloperController],
  providers: [DeveloperService],
})
export class DeveloperModule {}
