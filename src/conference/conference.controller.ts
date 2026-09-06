import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { ConferenceService } from './conference.service';
import { CreateConferenceDto } from './dto/create-conference.dto';
import { UpdateConferenceDto } from './dto/update-conference.dto';

// Endpoint GET bersifat publik di backend Java (permitAll di WebSecurityConfig),
// jadi tidak dipasang guard di sini supaya perilakunya konsisten. GET /latest
// dipakai juga oleh homepage publik (poster + status banner).
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

  @Get('active')
  findActive() {
    return this.conferenceService.findActive();
  }

  @Get('history')
  findHistory() {
    return this.conferenceService.findHistory();
  }

  @Get('history/:id')
  findHistoryDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.conferenceService.findHistoryDetail(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin, Role.Manager)
  create(@Body() dto: CreateConferenceDto) {
    return this.conferenceService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin, Role.Manager)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConferenceDto) {
    return this.conferenceService.update(id, dto);
  }
}
