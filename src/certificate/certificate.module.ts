import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';

@Module({
  imports: [AuthModule],
  controllers: [CertificateController],
  providers: [CertificateService],
})
export class CertificateModule {}
