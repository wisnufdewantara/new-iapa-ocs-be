import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssignReviewerController } from './assign-reviewer.controller';
import { AssignReviewerService } from './assign-reviewer.service';

@Module({
  imports: [AuthModule],
  controllers: [AssignReviewerController],
  providers: [AssignReviewerService],
})
export class AssignReviewerModule {}
