import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { PaymentController, PaymentTypesController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Ocs2SyncService } from './ocs2-sync.service';
import { ProofPullSyncService } from './proof-pull-sync.service';

@Module({
  imports: [AuthModule, EmailTemplateModule],
  controllers: [PaymentController, PaymentTypesController],
  providers: [PaymentService, Ocs2SyncService, ProofPullSyncService],
  exports: [Ocs2SyncService],
})
export class PaymentModule {}
