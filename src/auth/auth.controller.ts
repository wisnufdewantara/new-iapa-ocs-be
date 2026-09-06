import { Body, Controller, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { Role } from '../common/roles';
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

  // Password kedua khusus buat masuk area /admin. Wajib sudah login
  // sebagai Admin dulu (JwtAuthGuard + RolesGuard) sebelum boleh coba
  // password gate ini — jadi ini lapisan tambahan, bukan pengganti login.
  @Post('verify-admin-gate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.Admin)
  verifyAdminGate(@Body() dto: VerifyAdminGateDto) {
    if (dto.password !== process.env.ADMIN_GATE_PASSWORD) {
      throw new UnauthorizedException('Password admin gate salah');
    }
    return { verified: true };
  }
}
