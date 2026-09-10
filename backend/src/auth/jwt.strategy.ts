import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt.payload';
import { jwtSecret } from './constants';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(config: ConfigService, private readonly users: UserService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: jwtSecret(config.get<string>('JWT_SECRET'), config.get('NODE_ENV') === 'production'),
        });
    }
    async validate(payload: JwtPayload) {
        const id = Number(payload.sub);
        if (!Number.isSafeInteger(id) || id <= 0) throw new UnauthorizedException();
        const user = await this.users.findOneById(id).catch(() => null);
        if (!user) throw new UnauthorizedException();
        return { userId: user.id, email: user.email };
    }
}
