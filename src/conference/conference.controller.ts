import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { ConferenceService } from './conference.service';
import { CreateConferenceDto } from './dto/create-conference.dto';
import { UpdateConferenceDto } from './dto/update-conference.dto';
import { UpdateConferenceAwardsDto } from './dto/update-conference-awards.dto';
import { MovePosterDto } from './dto/move-poster.dto';
import { posterUploadOptions } from './poster-upload.config';

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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'create')
  create(@Body() dto: CreateConferenceDto, @Req() req: any) {
    return this.conferenceService.create(dto, (req.user as { userId: string }).userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConferenceDto, @Req() req: any) {
    return this.conferenceService.update(id, dto, (req.user as { userId: string }).userId);
  }

  @Patch(':id/awards')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'manage_awards')
  updateAwards(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConferenceAwardsDto, @Req() req: any) {
    return this.conferenceService.updateAwards(id, dto.bestPaperId, dto.bestPresenterId, (req.user as { userId: string }).userId);
  }

  @Get(':id/settings')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  findSettings(@Param('id', ParseUUIDPipe) id: string) {
    return this.conferenceService.findSettings(id);
  }

  @Put(':id/settings/:key')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  upsertSetting(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body('value') value: string,
  ) {
    return this.conferenceService.upsertSetting(id, key, value);
  }

  // Publik (dipakai homepage), sama seperti GET lain di controller ini.
  @Get(':id/posters')
  findPosters(@Param('id', ParseUUIDPipe) id: string) {
    return this.conferenceService.findPosters(id);
  }

  @Post(':id/posters')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  @UseInterceptors(FileInterceptor('image', posterUploadOptions))
  addPoster(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    const imageUrl = `/api/uploads/posters/${file.filename}`;
    return this.conferenceService.addPoster(id, imageUrl, (req.user as { userId: string }).userId);
  }

  @Delete(':id/posters/:posterId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  removePoster(@Param('posterId', ParseUUIDPipe) posterId: string, @Req() req: any) {
    return this.conferenceService.removePoster(posterId, (req.user as { userId: string }).userId);
  }

  @Patch(':id/posters/:posterId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('conference', 'update')
  movePoster(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('posterId', ParseUUIDPipe) posterId: string,
    @Body() dto: MovePosterDto,
    @Req() req: any,
  ) {
    return this.conferenceService.movePoster(id, posterId, dto.direction, (req.user as { userId: string }).userId);
  }
}
