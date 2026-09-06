import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [AuthModule],
  controllers: [PapersController],
  providers: [PapersService],
})
export class PapersModule {}
