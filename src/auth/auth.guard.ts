import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';

import { SessionService } from './session.service';

export type AuthContext = {
  userId: string;
  familyId: string;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: {
        authorization?: string;
      };
      user?: AuthContext;
    }>();

    const authorization = req.headers.authorization ?? '';

    const match = /^Bearer ([^\s]+)$/.exec(authorization);

    // Vérifier explicitement la présence du token
    const accessToken = match?.[1];

    if (!accessToken) {
      throw new UnauthorizedException('Bearer token requis ou invalide');
    }

    // Vérification du token et de la session
    const auth = await this.sessions.validateAccess(accessToken);

    req.user = auth;

    return true;
  }
}

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthContext }>();

    if (!request.user) {
      throw new UnauthorizedException('Utilisateur non authentifié');
    }

    return request.user;
  },
);
