import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificateRendererService } from './certificate-renderer.service';
import { designUploadOptions, signatureUploadOptions } from './certificate-template-upload.config';
import { CreateCertificateTemplateDto } from './dto/create-certificate-template.dto';
import { UpdateCertificateTemplateDto } from './dto/update-certificate-template.dto';
import { UpdateTemplateMappingsDto } from './dto/update-template-mappings.dto';

@Controller('api/certificate-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('certificate', 'manage_templates')
export class CertificateTemplatesController {
  constructor(
    private templates: CertificateTemplatesService,
    private renderer: CertificateRendererService,
  ) {}

  @Get()
  findAll() {
    return this.templates.findAll();
  }

  // Didaftarkan SEBELUM ':id' biar nggak ketangkep sebagai :id='fonts'.
  @Get('fonts')
  getFonts() {
    return this.templates.getFonts();
  }

  @Get('mappings')
  getMappings(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.templates.getMappings(conferenceId);
  }

  @Put('mappings/:conferenceId')
  putMappings(@Param('conferenceId', ParseUUIDPipe) conferenceId: string, @Body() dto: UpdateTemplateMappingsDto) {
    return this.templates.putMappings(conferenceId, dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findOne(id);
  }

  @Post()
  @UseInterceptors(FileInterceptor('design', designUploadOptions))
  create(@Body() dto: CreateCertificateTemplateDto, @UploadedFile() file: Express.Multer.File) {
    return this.templates.create(dto, file);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCertificateTemplateDto, @Req() req: any) {
    return this.templates.update(id, dto, (req.user as { userId: string }).userId);
  }

  @Post(':id/design')
  @UseInterceptors(FileInterceptor('design', designUploadOptions))
  replaceDesign(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.templates.replaceDesign(id, file);
  }

  @Post(':id/signers/:slot/image')
  @UseInterceptors(FileInterceptor('image', signatureUploadOptions))
  upsertSignerImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slot', ParseIntPipe) slot: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.templates.upsertSignerImage(id, slot, file);
  }

  @Delete(':id/signers/:slot/image')
  removeSignerImage(@Param('id', ParseUUIDPipe) id: string, @Param('slot', ParseIntPipe) slot: number) {
    return this.templates.removeSignerImage(id, slot);
  }

  @Post(':id/set-default')
  setDefault(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setDefault(id);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.duplicate(id);
  }

  // Render pakai sample name — TIDAK bikin baris issued_certificates (beda
  // dari generateFor() yang dipakai alur kirim/download beneran).
  @Post(':id/preview')
  @Header('Content-Type', 'application/pdf')
  async preview(@Param('id', ParseUUIDPipe) id: string, @Body('sampleName') sampleName: string, @Res() res: Response) {
    const template = await this.templates.renderPreviewTemplate(id);
    const pdf = await this.renderer.render(template, {
      recipientName: sampleName || 'Nama Lengkap Peserta',
      certTypeLabel: 'Presenter',
    });
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(pdf);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }
}
