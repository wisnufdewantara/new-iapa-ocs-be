import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { verifyFileToken } from '../common/file-access-token.util';
import { PapersService } from './papers.service';

// TANPA JwtAuthGuard — link ke sini harus bisa diklik langsung sebagai
// <a href> (dari UI biasa MAUPUN dari file laporan CSV/Excel yang
// didownload), yang nggak bisa bawa header Authorization kayak fetch API
// biasa. Otorisasi dicek lewat token di query string (lihat
// file-access-token.util.ts) — token-nya cuma pernah dikasih ke user
// yang emang berhak (lihat signedDocumentUrl di papers.service.ts, yang
// cuma dipanggil dari endpoint yang sudah di-guard login/permission).
@Controller('api/papers')
export class PaperDocumentController {
  constructor(private papersService: PapersService) {}

  @Get(':paperId/document')
  async downloadDocument(
    @Param('paperId', ParseUUIDPipe) paperId: string,
    @Query('token') token: string | undefined,
    @Res() res: any,
  ) {
    if (!verifyFileToken(token, 'paper-document', paperId)) {
      throw new ForbiddenException('Link tidak valid atau sudah kedaluwarsa');
    }
    const loc = await this.papersService.getDocumentDiskPath(paperId);
    // Paper hasil sync dari ocs2 lama nyimpen URL Supabase — redirect.
    if (loc.kind === 'remote') return res.redirect(302, loc.url);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(loc.path);
  }
}
