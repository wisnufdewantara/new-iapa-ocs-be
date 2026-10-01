import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EmailLogService } from './email-log.service';

// 1x1 GIF transparan (base64). Ini "tracking pixel": pas klien email load
// gambar ini, kita tau email-nya kebuka. SENGAJA publik (tanpa JwtAuthGuard)
// karena penerima email nggak login ke sistem.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

@Controller('api/email-track')
export class EmailTrackController {
  constructor(private emailLogService: EmailLogService) {}

  @Get('open/:token')
  async open(@Param('token') token: string, @Res() res: Response) {
    // URL pixel pakai akhiran ".png" biar keliatan wajar di sebagian klien,
    // walau isinya GIF — buang suffix-nya buat lookup token.
    const clean = token.replace(/\.(png|gif|jpg|jpeg)$/i, '');
    // Jangan sampai error tracking bikin pixel gagal render; selalu balikin gambar.
    await this.emailLogService.markOpened(clean).catch(() => undefined);
    // Pakai @Res() manual, jadi header diset langsung (dekorator @Header
    // nggak keterapkan di mode ini). no-store biar tiap buka ulang ke-hit lagi.
    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(PIXEL);
  }
}
