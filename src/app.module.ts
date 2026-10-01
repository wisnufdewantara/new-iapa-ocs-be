import { Module } from '@nestjs/common';
// Alias -- nama "ScheduleModule" udah dipakai fitur jadwal sesi konferensi
// (./schedule/schedule.module), beda total sama cron scheduler NestJS ini.
import { ScheduleModule as CronScheduleModule } from '@nestjs/schedule';
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
import { FunctionalTestModule } from './functional-test/functional-test.module';
import { EmailTemplateModule } from './email-template/email-template.module';
import { EmailLogModule } from './email-log/email-log.module';
import { CertificateTemplatesModule } from './certificate-templates/certificate-templates.module';
import { CertificateValidationModule } from './certificate-validation/certificate-validation.module';

@Module({
  imports: [
    CronScheduleModule.forRoot(),
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
    CertificateTemplatesModule,
    CertificateModule,
    CertificateValidationModule,
    PaymentModule,
    ParticipantModule,
    DeveloperModule,
    FunctionalTestModule,
    EmailTemplateModule,
    EmailLogModule,
  ],
})
export class AppModule {}
