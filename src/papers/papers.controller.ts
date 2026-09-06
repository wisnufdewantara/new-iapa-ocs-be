import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
import { PapersService } from './papers.service';
import { UpdatePaperStatusDto } from './dto/update-paper-status.dto';
import { SubmitPaperDto } from './dto/submit-paper.dto';
import { papersUploadOptions } from './papers-upload.config';

@Controller('api/papers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin, Role.Manager, Role.Reviewer)
export class PapersController {
  constructor(private papersService: PapersService) {}

  @Get()
  findByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.papersService.findByConference(conferenceId);
  }

  @Get('mine')
  @Roles(Role.Peserta)
  findMine(@Req() req: any) {
    return this.papersService.findMine((req.user as { userId: string }).userId);
  }

  @Post()
  @Roles(Role.Peserta)
  @UseInterceptors(FileInterceptor('document', papersUploadOptions))
  submitPaper(@Req() req: any, @Body() dto: SubmitPaperDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Dokumen paper wajib diupload');
    }
    const documentUrl = `/api/uploads/papers/${file.filename}`;
    return this.papersService.submitPaper((req.user as { userId: string }).userId, dto, documentUrl);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaperStatusDto) {
    return this.papersService.updateStatus(id, dto.conferenceStatus);
  }
}
