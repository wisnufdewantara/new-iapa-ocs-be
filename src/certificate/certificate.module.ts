import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { CertificateTemplatesModule } from '../certificate-templates/certificate-templates.module';
import { CertificateController, MyCertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';

@Module({
  imports: [AuthModule, EmailTemplateModule, CertificateTemplatesModule],
  controllers: [CertificateController, MyCertificateController],
  providers: [CertificateService],
})
export class CertificateModule {}
