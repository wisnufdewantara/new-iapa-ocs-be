import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { verifyFileToken } from '../common/file-access-token.util';
import { assertValidFeedbackFile, paperFeedbackUploadOptions } from '../papers/paper-feedback-upload.config';
import { PaperFeedbackService } from './paper-feedback.service';

// Nama file asli cuma buat label tampilan (dirender sebagai teks, bukan
// path) — tetap dibersihin dari karakter kontrol & dibatasi panjangnya.
function displayFileName(file: Express.Multer.File): string {
  const base = (file.originalname || 'lampiran').split(/[\\/]/).pop() as string;
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || 'lampiran';
}

function storedFile(file: Express.Multer.File | undefined) {
  if (!file) return null;
  assertValidFeedbackFile(file.path, file.mimetype);
  return { url: `/api/uploads/papers/feedback/${file.filename}`, name: displayFileName(file) };
}

@Controller('api/paper-feedback')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaperFeedbackController {
  constructor(private feedback: PaperFeedbackService) {}

  // Sisi reviewer/admin — nama pengirim asli kelihatan.
  @Get('reviewer/:paperId')
  @RequirePermission('papers', 'review')
  reviewerDetail(@Param('paperId', ParseUUIDPipe) paperId: string) {
    return this.feedback.reviewerDetail(paperId);
  }

  @Post('reviewer/:paperId/messages')
  @RequirePermission('papers', 'review')
  @UseInterceptors(FileInterceptor('file', paperFeedbackUploadOptions))
  reviewerPost(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body('body') body: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    return this.feedback.postMessage(paperId, 'reviewer', req.user.userId, body, storedFile(file));
  }

  // Sisi penulis (submitter) — reviewer tampil sebagai "Tim Reviewer".
  @Get('mine/:paperId')
  @RequirePermission('papers', 'submit')
  authorThread(@Param('paperId', ParseUUIDPipe) paperId: string, @Req() req: any) {
    return this.feedback.authorThread(paperId, req.user.userId);
  }

  @Post('mine/:paperId/messages')
  @RequirePermission('papers', 'submit')
  @UseInterceptors(FileInterceptor('file', paperFeedbackUploadOptions))
  authorPost(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Body('body') body: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: any,
  ) {
    return this.feedback.postMessage(paperId, 'author', req.user.userId, body, storedFile(file));
  }
}

// TANPA guard — link lampiran harus bisa diklik langsung (<a href>, email,
// laporan Excel). Otorisasi lewat token, yang cuma dibagikan ke reviewer
// dan penulis paper itu sendiri (lihat signedFeedbackMessageFileUrl).
@Controller('api/paper-feedback/files')
export class PaperFeedbackFileController {
  constructor(private feedback: PaperFeedbackService) {}

  @Get(':messageId')
  async download(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Query('token') token: string | undefined,
    @Res() res: any,
  ) {
    if (!verifyFileToken(token, 'feedback-message', messageId)) {
      throw new ForbiddenException('Link tidak valid atau sudah kedaluwarsa');
    }
    const loc = await this.feedback.getMessageFileLocation(messageId);
    if (loc.kind === 'remote') return res.redirect(302, loc.url);
    const ext = loc.path.slice(loc.path.lastIndexOf('.'));
    const contentType =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === '.doc'
            ? 'application/msword'
            : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (ext !== '.pdf') res.setHeader('Content-Disposition', `attachment; filename="feedback${ext}"`);
    res.sendFile(loc.path);
  }
}
