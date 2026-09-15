import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';
import { DEFAULT_EMAIL_TEMPLATES } from './email-template.constant';

@Injectable()
export class EmailTemplateService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    const rows = await this.prisma.email_template.findMany();
    const byKey = new Map(rows.map((r) => [r.template_key, r]));
    return DEFAULT_EMAIL_TEMPLATES.map((d) => {
      const row = byKey.get(d.key);
      return {
        templateKey: d.key,
        label: d.label,
        variables: d.variables,
        subject: row?.subject ?? d.subject,
        bodyHtml: row?.body_html ?? d.bodyHtml,
      };
    });
  }

  async update(key: string, dto: { subject: string; bodyHtml: string }, actorUserId?: string) {
    const def = DEFAULT_EMAIL_TEMPLATES.find((d) => d.key === key);
    if (!def) throw new NotFoundException(`Template email "${key}" tidak dikenal`);

    const updated = await this.prisma.email_template.upsert({
      where: { template_key: key },
      create: { template_key: key, label: def.label, subject: dto.subject, body_html: dto.bodyHtml },
      update: { subject: dto.subject, body_html: dto.bodyHtml },
    });
    await this.auditLog.log(actorUserId, 'update_email_template', 'email_template', key);
    return updated;
  }

  // Dipakai LoaService/CertificateService/PaymentService — ambil
  // subject+body (override kalau ada, default kalau belum) lalu
  // interpolate {{variabel}} dari data transaksi terkait.
  async render(key: string, variables: Record<string, string>) {
    const templates = await this.findAll();
    const t = templates.find((t) => t.templateKey === key);
    if (!t) throw new NotFoundException(`Template email "${key}" tidak dikenal`);

    const interpolate = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? '');
    return { subject: interpolate(t.subject), bodyHtml: interpolate(t.bodyHtml) };
  }
}
