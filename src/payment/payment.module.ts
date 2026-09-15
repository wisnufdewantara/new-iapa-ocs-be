import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { PaymentController, PaymentTypesController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [AuthModule, EmailTemplateModule],
  controllers: [PaymentController, PaymentTypesController],
  providers: [PaymentService],
})
export class PaymentModule {}
