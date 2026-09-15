import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { LoaController } from './loa.controller';
import { LoaService } from './loa.service';

@Module({
  imports: [AuthModule, EmailTemplateModule],
  controllers: [LoaController],
  providers: [LoaService],
})
export class LoaModule {}
