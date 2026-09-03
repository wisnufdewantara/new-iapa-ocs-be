import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConferenceService } from './conference.service';

// Endpoint conference bersifat publik di backend Java (permitAll di WebSecurityConfig),
// jadi tidak dipasang guard di sini supaya perilakunya konsisten.
@Controller('api/conferences')
export class ConferenceController {
  constructor(private conferenceService: ConferenceService) {}

  @Get()
  findAll(@Query('year') year?: string) {
    return this.conferenceService.findAll(year);
  }

  @Get('latest')
  findLatest() {
    return this.conferenceService.findLatest();
  }
}
