import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesController, MenuController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule],
  controllers: [RolesController, MenuController],
  providers: [RolesService],
})
export class RolesModule {}
