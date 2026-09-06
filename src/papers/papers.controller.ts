import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { PapersService } from './papers.service';
import { UpdatePaperStatusDto } from './dto/update-paper-status.dto';

@Controller('api/papers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager, Role.Reviewer)
export class PapersController {
  constructor(private papersService: PapersService) {}

  @Get()
  findByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.papersService.findByConference(conferenceId);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaperStatusDto) {
    return this.papersService.updateStatus(id, dto.conferenceStatus);
  }
}
