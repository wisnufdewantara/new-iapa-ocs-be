import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { verifyFileToken } from '../common/file-access-token.util';
import { StoredFileLocation } from '../common/upload-path.util';
import { PaymentService, contentTypeForPath } from './payment.service';

// File lokal di-stream, bukti lama dari Supabase di-redirect (lihat
// resolveStoredFile) — token udah dicek sebelum ini dipanggil.
function sendStoredFile(res: any, loc: StoredFileLocation) {
  if (loc.kind === 'remote') return res.redirect(302, loc.url);
  res.setHeader('Content-Type', contentTypeForPath(loc.path));
  res.sendFile(loc.path);
}

// TANPA JwtAuthGuard — sama alasannya kayak PaperDocumentController:
// link bukti transfer harus bisa diklik langsung sebagai <a href> (UI
// biasa maupun dari laporan CSV/Excel), nggak bisa bawa header
// Authorization. Otorisasi dicek lewat token (lihat
// file-access-token.util.ts), yang cuma pernah dikasih ke user yang
// emang berhak (lihat signedTeamProofUrl dkk di payment.service.ts,
// yang cuma dipanggil dari endpoint ber-guard payment:verify).
@Controller('api/payment')
export class PaymentProofController {
  constructor(private paymentService: PaymentService) {}

  // Proof TERBARU buat 1 payment — dipakai link di laporan.
  @Get(':paymentId/proof')
  async downloadTeamProof(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Query('token') token: string | undefined,
    @Res() res: any,
  ) {
    if (!verifyFileToken(token, 'team-proof', paymentId)) {
      throw new ForbiddenException('Link tidak valid atau sudah kedaluwarsa');
    }
    sendStoredFile(res, await this.paymentService.getTeamProofDiskPath(paymentId));
  }

  // Proof SPESIFIK by id — dipakai halaman detail pembayaran yang
  // nampilin semua proof 1 payment (bisa lebih dari 1 kalau re-upload).
  @Get('proof/:proofId')
  async downloadTeamProofById(
    @Param('proofId', ParseUUIDPipe) proofId: string,
    @Query('token') token: string | undefined,
    @Res() res: any,
  ) {
    if (!verifyFileToken(token, 'team-proof-by-id', proofId)) {
      throw new ForbiddenException('Link tidak valid atau sudah kedaluwarsa');
    }
    sendStoredFile(res, await this.paymentService.getTeamProofDiskPathByProofId(proofId));
  }

  @Get('participant/:attendanceId/proof')
  async downloadParticipantProof(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Query('token') token: string | undefined,
    @Res() res: any,
  ) {
    if (!verifyFileToken(token, 'participant-proof', attendanceId)) {
      throw new ForbiddenException('Link tidak valid atau sudah kedaluwarsa');
    }
    sendStoredFile(res, await this.paymentService.getParticipantProofDiskPath(attendanceId));
  }
}
