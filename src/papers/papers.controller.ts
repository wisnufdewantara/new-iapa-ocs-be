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
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { PapersService } from './papers.service';
import { UpdatePaperStatusDto } from './dto/update-paper-status.dto';
import { SubmitPaperDto } from './dto/submit-paper.dto';
import { papersUploadOptions } from './papers-upload.config';

@Controller('api/papers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('papers', 'review')
export class PapersController {
  constructor(private papersService: PapersService) {}

  @Get()
  findByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.papersService.findByConference(conferenceId);
  }

  @Get('mine')
  @RequirePermission('papers', 'submit')
  findMine(@Req() req: any) {
    return this.papersService.findMine((req.user as { userId: string }).userId);
  }

  @Post()
  @RequirePermission('papers', 'submit')
  @UseInterceptors(FileInterceptor('document', papersUploadOptions))
  submitPaper(@Req() req: any, @Body() dto: SubmitPaperDto, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Dokumen paper wajib diupload');
    }
    const documentUrl = `/api/uploads/papers/${file.filename}`;
    return this.papersService.submitPaper((req.user as { userId: string }).userId, dto, documentUrl);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaperStatusDto, @Req() req: any) {
    return this.papersService.updateStatus(id, dto.conferenceStatus, (req.user as { userId: string }).userId);
  }
}
