import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CertificateTemplatesController } from './certificate-templates.controller';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificateRendererService } from './certificate-renderer.service';
import { IssuedCertificatesService } from './issued-certificates.service';

@Module({
  imports: [AuthModule],
  controllers: [CertificateTemplatesController],
  providers: [CertificateTemplatesService, CertificateRendererService, IssuedCertificatesService],
  exports: [CertificateTemplatesService, CertificateRendererService, IssuedCertificatesService],
})
export class CertificateTemplatesModule {}
