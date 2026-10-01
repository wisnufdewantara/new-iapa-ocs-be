import { Module } from '@nestjs/common';
import { CertificateValidationController } from './certificate-validation.controller';
import { CertificateValidationService } from './certificate-validation.service';

@Module({
  controllers: [CertificateValidationController],
  providers: [CertificateValidationService],
})
export class CertificateValidationModule {}
