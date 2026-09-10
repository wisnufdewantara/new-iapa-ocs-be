import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  log(actorUserId: string | undefined, action: string, entity: string, entityId?: string, detail?: string) {
    return this.prisma.audit_log.create({
      data: { actor_user_id: actorUserId, action, entity, entity_id: entityId, detail },
    });
  }

  findRecent(limit: number) {
    return this.prisma.audit_log.findMany({ orderBy: { created_at: 'desc' }, take: limit });
  }
}
