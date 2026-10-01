import { Controller, Get, Param } from '@nestjs/common';
import { CertificateValidationService } from './certificate-validation.service';

// SENGAJA controller terpisah dari CertificateTemplatesController (yang
// ter-guard @RequirePermission di level class) — di NestJS, guard class-level
// nggak bisa di-override per-method, jadi endpoint publik HARUS di
// controller sendiri tanpa @UseGuards sama sekali. Lihat juga pola yang
// sama di FunctionalTestController.
@Controller('api/certificate-validation')
export class CertificateValidationController {
  constructor(private validation: CertificateValidationService) {}

  @Get(':code')
  validate(@Param('code') code: string) {
    return this.validation.validate(code);
  }
}
