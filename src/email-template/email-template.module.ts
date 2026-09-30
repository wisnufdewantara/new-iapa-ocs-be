import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateController } from './email-template.controller';
import { EmailTemplateService } from './email-template.service';

// forwardRef karena AuthModule sekarang JUGA import modul ini (buat
// kirim email reset password) — circular, tapi sah di Nest selama
// dua-duanya pakai forwardRef di imports masing-masing.
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [EmailTemplateController],
  providers: [EmailTemplateService],
  exports: [EmailTemplateService],
})
export class EmailTemplateModule {}
