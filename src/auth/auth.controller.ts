import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyAdminGateDto } from './dto/verify-admin-gate.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Dipakai buat auto-fill data penulis pertama di form Submit Paper
  // (niru VSubmitPaper.vue lama), karena JWT payload cuma bawa
  // sub/username/role, bukan affiliation/phone/gender.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return this.authService.findProfile(req.user.userId);
  }

  // Password kedua khusus buat masuk area /admin. Wajib sudah punya izin
  // admin_gate:verify dulu (JwtAuthGuard + PermissionsGuard) sebelum boleh
  // coba password gate ini — jadi ini lapisan tambahan, bukan pengganti login.
  @Post('verify-admin-gate')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('admin_gate', 'verify')
  verifyAdminGate(@Body() dto: VerifyAdminGateDto) {
    if (dto.password !== process.env.ADMIN_GATE_PASSWORD) {
      throw new UnauthorizedException('Password admin gate salah');
    }
    return { verified: true };
  }
}
