import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { PaperFeedbackController, PaperFeedbackFileController } from './paper-feedback.controller';
import { PaperFeedbackService } from './paper-feedback.service';

@Module({
  imports: [AuthModule, EmailTemplateModule],
  controllers: [PaperFeedbackController, PaperFeedbackFileController],
  providers: [PaperFeedbackService],
  exports: [PaperFeedbackService],
})
export class PaperFeedbackModule {}
