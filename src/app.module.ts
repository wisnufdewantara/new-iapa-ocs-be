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
import { AuditLogModule } from './common/audit-log.module';
import { MailerModule } from './mailer/mailer.module';
import { RolesModule } from './roles/roles.module';
import { LoaModule } from './loa/loa.module';
import { CertificateModule } from './certificate/certificate.module';
import { PaymentModule } from './payment/payment.module';
import { ParticipantModule } from './participant/participant.module';
import { DeveloperModule } from './developer/developer.module';

@Module({
  imports: [
    PrismaModule,
    AuditLogModule,
    MailerModule,
    AuthModule,
    ConferenceModule,
    ScheduleModule,
    AttendanceModule,
    PapersModule,
    SettingsModule,
    AssignReviewerModule,
    UsersModule,
    RolesModule,
    LoaModule,
    CertificateModule,
    PaymentModule,
    ParticipantModule,
    DeveloperModule,
  ],
})
export class AppModule {}
