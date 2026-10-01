import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../common/audit-log.service';
import { CERTIFICATE_FONTS } from './certificate-fonts.constant';
import { PLACEHOLDER_VARIABLES } from './certificate-placeholder-variables.constant';
import { readImageMeta } from './certificate-file.util';
import { UpdateCertificateTemplateDto } from './dto/update-certificate-template.dto';
import { UpdateTemplateMappingsDto } from './dto/update-template-mappings.dto';
import type { CertType } from './certificate-types';

const MAPPING_KEY_TO_CERT_TYPE: Record<keyof UpdateTemplateMappingsDto, CertType> = {
  participant: 'participant',
  presenter: 'presenter',
  bestPaper: 'best_paper',
  bestPresenter: 'best_presenter',
};

@Injectable()
export class CertificateTemplatesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  getFonts() {
    return Object.entries(CERTIFICATE_FONTS).map(([key, def]) => ({ key, label: def.label }));
  }

  getPlaceholderVariables() {
    return PLACEHOLDER_VARIABLES;
  }

  async findAll() {
    const templates = await this.prisma.certificate_templates.findMany({
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { conference_certificate_templates: true } } },
    });
    return templates.map((t) => this.toListItem(t));
  }

  async findOne(id: string) {
    const t = await this.prisma.certificate_templates.findUnique({
      where: { id },
      include: {
        certificate_template_signers: { orderBy: { slot: 'asc' } },
        certificate_template_placeholders: { orderBy: { slot: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('Template sertifikat tidak ditemukan');
    return this.toDetail(t);
  }

  async create(dto: { name: string; description?: string }, file: Express.Multer.File) {
    const imageUrl = `/api/uploads/certificate-templates/${file.filename}`;
    const meta = await readImageMeta(file.path, file.mimetype);
    const created = await this.prisma.certificate_templates.create({
      data: {
        name: dto.name,
        description: dto.description,
        design_image_url: imageUrl,
        design_width_px: meta.width,
        design_height_px: meta.height,
      },
    });
    await this.auditLog.log(undefined, 'certificate_template_create', 'certificate_templates', created.id);
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateCertificateTemplateDto, actorUserId?: string) {
    const existing = await this.prisma.certificate_templates.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Template sertifikat tidak ditemukan');

    const { signers, placeholders, ...rest } = dto;
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      data[this.toSnake(key)] = value;
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.certificate_templates.update({ where: { id }, data });
      }
      if (signers) {
        const keepSlots = signers.map((s) => s.slot);
        await tx.certificate_template_signers.deleteMany({
          where: { template_id: id, slot: { notIn: keepSlots.length ? keepSlots : [0] } },
        });
        for (const s of signers) {
          await tx.certificate_template_signers.upsert({
            where: { template_id_slot: { template_id: id, slot: s.slot } },
            create: {
              template_id: id,
              slot: s.slot,
              signer_name: s.signerName,
              signer_title: s.signerTitle,
              pos_x: s.posX,
              pos_y: s.posY,
              width: s.width,
            },
            update: {
              signer_name: s.signerName,
              signer_title: s.signerTitle,
              pos_x: s.posX,
              pos_y: s.posY,
              width: s.width,
            },
          });
        }
      }
      if (placeholders) {
        const keepSlots = placeholders.map((p) => p.slot);
        await tx.certificate_template_placeholders.deleteMany({
          where: { template_id: id, slot: { notIn: keepSlots.length ? keepSlots : [0] } },
        });
        for (const p of placeholders) {
          await tx.certificate_template_placeholders.upsert({
            where: { template_id_slot: { template_id: id, slot: p.slot } },
            create: {
              template_id: id,
              slot: p.slot,
              content: p.content,
              font_key: p.fontKey,
              font_size: p.fontSize,
              color: p.color,
              pos_x: p.posX,
              pos_y: p.posY,
              max_width: p.maxWidth,
            },
            update: {
              content: p.content,
              font_key: p.fontKey,
              font_size: p.fontSize,
              color: p.color,
              pos_x: p.posX,
              pos_y: p.posY,
              max_width: p.maxWidth,
            },
          });
        }
      }
    });

    await this.auditLog.log(actorUserId, 'certificate_template_update', 'certificate_templates', id);
    return this.findOne(id);
  }

  async replaceDesign(id: string, file: Express.Multer.File) {
    const existing = await this.prisma.certificate_templates.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Template sertifikat tidak ditemukan');
    const meta = await readImageMeta(file.path, file.mimetype);
    const prevAspect = existing.design_width_px / existing.design_height_px;
    const newAspect = meta.width / meta.height;
    const aspectChanged = Math.abs(prevAspect - newAspect) > 0.02;
    await this.prisma.certificate_templates.update({
      where: { id },
      data: {
        design_image_url: `/api/uploads/certificate-templates/${file.filename}`,
        design_width_px: meta.width,
        design_height_px: meta.height,
      },
    });
    return { ...(await this.findOne(id)), aspectChanged };
  }

  async upsertSignerImage(id: string, slot: number, file: Express.Multer.File) {
    const template = await this.prisma.certificate_templates.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template sertifikat tidak ditemukan');
    const meta = await readImageMeta(file.path, file.mimetype);
    const imageUrl = `/api/uploads/certificate-signatures/${file.filename}`;
    await this.prisma.certificate_template_signers.upsert({
      where: { template_id_slot: { template_id: id, slot } },
      create: {
        template_id: id,
        slot,
        signer_name: '',
        signature_image_url: imageUrl,
        signature_width_px: meta.width,
        signature_height_px: meta.height,
      },
      update: { signature_image_url: imageUrl, signature_width_px: meta.width, signature_height_px: meta.height },
    });
    return this.findOne(id);
  }

  async removeSignerImage(id: string, slot: number) {
    await this.prisma.certificate_template_signers.updateMany({
      where: { template_id: id, slot },
      data: { signature_image_url: null, signature_width_px: null, signature_height_px: null },
    });
    return this.findOne(id);
  }

  async setDefault(id: string) {
    await this.prisma.$transaction([
      this.prisma.certificate_templates.updateMany({ data: { is_default: false }, where: {} }),
      this.prisma.certificate_templates.update({ where: { id }, data: { is_default: true } }),
    ]);
    return this.findOne(id);
  }

  async duplicate(id: string) {
    const source = await this.prisma.certificate_templates.findUnique({
      where: { id },
      include: { certificate_template_signers: true, certificate_template_placeholders: true },
    });
    if (!source) throw new NotFoundException('Template sertifikat tidak ditemukan');

    const {
      id: _id,
      created_at: _c,
      updated_at: _u,
      certificate_template_signers,
      certificate_template_placeholders,
      is_default: _d,
      ...rest
    } = source;
    const copy = await this.prisma.certificate_templates.create({
      data: { ...rest, name: `${source.name} (Salinan)`, is_default: false },
    });
    for (const s of certificate_template_signers) {
      const { id: _sid, template_id: _tid, created_at: _sc, updated_at: _su, ...signerRest } = s;
      await this.prisma.certificate_template_signers.create({ data: { ...signerRest, template_id: copy.id } });
    }
    for (const p of certificate_template_placeholders) {
      const { id: _pid, template_id: _ptid, created_at: _pc, updated_at: _pu, ...placeholderRest } = p;
      await this.prisma.certificate_template_placeholders.create({ data: { ...placeholderRest, template_id: copy.id } });
    }
    return this.findOne(copy.id);
  }

  async remove(id: string) {
    const mappings = await this.prisma.conference_certificate_templates.findMany({
      where: { template_id: id },
      include: { conference: { select: { conference_name: true } } },
    });
    if (mappings.length) {
      const names = mappings.map((m) => m.conference.conference_name).join(', ');
      throw new ConflictException(`Template masih dipakai di conference: ${names}`);
    }
    await this.prisma.certificate_templates.delete({ where: { id } });
    await this.auditLog.log(undefined, 'certificate_template_delete', 'certificate_templates', id);
    return { deleted: true };
  }

  async getMappings(conferenceId: string) {
    const [rows, defaultTemplate] = await Promise.all([
      this.prisma.conference_certificate_templates.findMany({ where: { conference_id: conferenceId } }),
      this.prisma.certificate_templates.findFirst({ where: { is_default: true }, select: { id: true, name: true } }),
    ]);
    const byCertType = new Map(rows.map((r) => [r.cert_type, r.template_id]));
    return {
      participant: byCertType.get('participant') ?? null,
      presenter: byCertType.get('presenter') ?? null,
      bestPaper: byCertType.get('best_paper') ?? null,
      bestPresenter: byCertType.get('best_presenter') ?? null,
      defaultTemplate,
    };
  }

  async putMappings(conferenceId: string, dto: UpdateTemplateMappingsDto) {
    await this.prisma.$transaction(async (tx) => {
      for (const [key, certType] of Object.entries(MAPPING_KEY_TO_CERT_TYPE) as [keyof UpdateTemplateMappingsDto, CertType][]) {
        if (!(key in dto)) continue;
        const templateId = dto[key];
        if (templateId) {
          await tx.conference_certificate_templates.upsert({
            where: { conference_id_cert_type: { conference_id: conferenceId, cert_type: certType } },
            create: { conference_id: conferenceId, cert_type: certType, template_id: templateId },
            update: { template_id: templateId },
          });
        } else {
          await tx.conference_certificate_templates.deleteMany({ where: { conference_id: conferenceId, cert_type: certType } });
        }
      }
    });
    return this.getMappings(conferenceId);
  }

  // Urutan resolusi: mapping eksplisit -> template is_default -> null
  // (caller fallback ke generator hardcoded lama).
  async resolveTemplate(conferenceId: string | null | undefined, certType: CertType) {
    if (conferenceId) {
      const mapping = await this.prisma.conference_certificate_templates.findUnique({
        where: { conference_id_cert_type: { conference_id: conferenceId, cert_type: certType } },
      });
      if (mapping) {
        return this.prisma.certificate_templates.findUnique({
          where: { id: mapping.template_id },
          include: {
            certificate_template_signers: { orderBy: { slot: 'asc' } },
            certificate_template_placeholders: { orderBy: { slot: 'asc' } },
          },
        });
      }
    }
    return this.prisma.certificate_templates.findFirst({
      where: { is_default: true },
      include: {
        certificate_template_signers: { orderBy: { slot: 'asc' } },
        certificate_template_placeholders: { orderBy: { slot: 'asc' } },
      },
    });
  }

  async renderPreviewTemplate(id: string) {
    const t = await this.prisma.certificate_templates.findUnique({
      where: { id },
      include: {
        certificate_template_signers: { orderBy: { slot: 'asc' } },
        certificate_template_placeholders: { orderBy: { slot: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('Template sertifikat tidak ditemukan');
    return t;
  }

  private toSnake(camel: string) {
    return camel.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
  }

  private toListItem(t: any) {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      designImageUrl: t.design_image_url,
      designWidthPx: t.design_width_px,
      designHeightPx: t.design_height_px,
      isDefault: t.is_default,
      updatedAt: t.updated_at,
      usedBy: t._count?.conference_certificate_templates ?? 0,
    };
  }

  private toDetail(t: any) {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      designImageUrl: t.design_image_url,
      designWidthPx: t.design_width_px,
      designHeightPx: t.design_height_px,
      isDefault: t.is_default,
      nameFontKey: t.name_font_key,
      nameFontSize: t.name_font_size,
      nameColor: t.name_color,
      namePosX: t.name_pos_x,
      namePosY: t.name_pos_y,
      nameMaxWidth: t.name_max_width,
      labelEnabled: t.label_enabled,
      labelFontSize: t.label_font_size,
      labelPosX: t.label_pos_x,
      labelPosY: t.label_pos_y,
      bodyFontKey: t.body_font_key,
      signerFontSize: t.signer_font_size,
      signerColor: t.signer_color,
      page2Enabled: t.page2_enabled,
      page2Title: t.page2_title,
      page2Content: t.page2_content,
      page2TotalJp: t.page2_total_jp,
      page2FontSize: t.page2_font_size,
      qrEnabled: t.qr_enabled,
      qrPosX: t.qr_pos_x,
      qrPosY: t.qr_pos_y,
      qrSize: t.qr_size,
      updatedAt: t.updated_at,
      signers: (t.certificate_template_signers ?? []).map((s: any) => ({
        slot: s.slot,
        signerName: s.signer_name,
        signerTitle: s.signer_title,
        signatureImageUrl: s.signature_image_url,
        signatureWidthPx: s.signature_width_px,
        signatureHeightPx: s.signature_height_px,
        posX: s.pos_x,
        posY: s.pos_y,
        width: s.width,
      })),
      placeholders: (t.certificate_template_placeholders ?? []).map((p: any) => ({
        slot: p.slot,
        content: p.content,
        fontKey: p.font_key,
        fontSize: p.font_size,
        color: p.color,
        posX: p.pos_x,
        posY: p.pos_y,
        maxWidth: p.max_width,
      })),
    };
  }
}
