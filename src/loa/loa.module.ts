import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LoaController } from './loa.controller';
import { LoaService } from './loa.service';

@Module({
  imports: [AuthModule],
  controllers: [LoaController],
  providers: [LoaService],
})
export class LoaModule {}
