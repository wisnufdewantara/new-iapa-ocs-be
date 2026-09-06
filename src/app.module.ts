import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConferenceModule } from './conference/conference.module';
import { ScheduleModule } from './schedule/schedule.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PapersModule } from './papers/papers.module';
import { SettingsModule } from './settings/settings.module';
import { AssignReviewerModule } from './assign-reviewer/assign-reviewer.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ConferenceModule,
    ScheduleModule,
    AttendanceModule,
    PapersModule,
    SettingsModule,
    AssignReviewerModule,
    UsersModule,
  ],
})
export class AppModule {}
