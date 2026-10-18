import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { PaymentController, PaymentTypesController } from './payment.controller';
import { PaymentProofController } from './payment-proof.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [AuthModule, EmailTemplateModule],
  controllers: [PaymentController, PaymentTypesController, PaymentProofController],
  providers: [PaymentService],
})
export class PaymentModule {}
