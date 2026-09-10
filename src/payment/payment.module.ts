import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentController, PaymentTypesController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [AuthModule],
  controllers: [PaymentController, PaymentTypesController],
  providers: [PaymentService],
})
export class PaymentModule {}
