import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { EmailTemplateService } from './email-template.service';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';

// Sama permission dengan System Settings (settings:manage) — template
// email ini konsepnya bagian dari pengaturan sistem.
@Controller('api/email-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('settings', 'manage')
export class EmailTemplateController {
  constructor(private emailTemplateService: EmailTemplateService) {}

  @Get()
  findAll() {
    return this.emailTemplateService.findAll();
  }

  @Put(':key')
  update(@Param('key') key: string, @Body() dto: UpdateEmailTemplateDto, @Req() req: any) {
    return this.emailTemplateService.update(key, dto, (req.user as { userId: string }).userId);
  }
}
