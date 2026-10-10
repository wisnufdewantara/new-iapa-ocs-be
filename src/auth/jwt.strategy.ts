import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  // imp = user_id admin yang lagi "login sebagai" user ini (lihat
  // UsersService.impersonate) — undefined untuk login biasa.
  async validate(payload: { sub: string; username: string; role: string; imp?: string }) {
    return { userId: payload.sub, username: payload.username, role: payload.role, impersonatorId: payload.imp };
  }
}
