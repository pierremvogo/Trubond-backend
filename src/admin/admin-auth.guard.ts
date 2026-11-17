import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';

import { AdminAuthService, AdminContext } from './admin-auth.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: {
        authorization?: string;
      };
      admin?: AdminContext;
    }>();

    const authorization = request.headers.authorization ?? '';

    const match = /^Bearer ([^\s]+)$/.exec(authorization);

    const token = match?.[1];

    if (!token) {
      throw new UnauthorizedException('Token administrateur requis');
    }

    request.admin = await this.adminAuth.validate(token);

    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminContext => {
    const request = context.switchToHttp().getRequest<{
      admin?: AdminContext;
    }>();

    if (!request.admin) {
      throw new UnauthorizedException('Administrateur non authentifié');
    }

    return request.admin;
  },
);
