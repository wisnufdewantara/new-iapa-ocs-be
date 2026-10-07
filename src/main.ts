import 'reflect-metadata';
import 'dotenv/config';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Dokumen paper & bukti transfer SENGAJA diblokir dari static route di
  // bawah — keduanya sekarang HARUS lewat endpoint terautentikasi/token
  // (PaperDocumentController, PaymentProofController), nggak boleh diakses
  // langsung publik tanpa auth lagi. Subfolder lain (certificate-templates,
  // dst) tetap publik lewat static route seperti biasa — udah dicek
  // terpisah (random UUID filename, nggak ada listing, nggak ada
  // disclosure URL saat gagal validasi).
  app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    if (req.path.startsWith('/api/uploads/papers/') || req.path.startsWith('/api/uploads/payment-proofs/')) {
      res.status(404).end();
      return;
    }
    next();
  });
  // File upload baru (Submit Paper dst) disimpan di disk lokal server,
  // diserve balik lewat static route ini — lihat papers-upload.config.ts.
  // Prefix SENGAJA di bawah /api (bukan /uploads di root): di produksi,
  // .htaccess FE cuma exclude /api dari SPA-fallback rewrite, jadi path
  // di luar /api nggak pernah nyampe ke Node app ini sama sekali (balik
  // ke index.html, Content-Type text/html) — ketauan pas smoke test
  // 2026-09-07 setelah deploy Submit Paper.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/api/uploads' });
  const port = process.env.PORT || 8081;
  await app.listen(port);
  console.log(`newocs-be listening on port ${port}`);
}
bootstrap();
