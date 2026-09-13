import { Module } from '@nestjs/common';
import { FunctionalTestController } from './functional-test.controller';
import { FunctionalTestService } from './functional-test.service';

@Module({
  controllers: [FunctionalTestController],
  providers: [FunctionalTestService],
  exports: [FunctionalTestService],
})
export class FunctionalTestModule {}
