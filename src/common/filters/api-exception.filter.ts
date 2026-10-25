import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest & { id?: string }>();
    const reply = http.getResponse<FastifyReply>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = typeof response === 'string'
      ? response
      : response && typeof response === 'object' && 'message' in response
        ? (response as { message: unknown }).message
        : status >= 500 ? 'Une erreur interne est survenue.' : 'La requête est invalide.';
    const errorCode = status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`;
    const safeMessage = status >= 500 ? 'Une erreur interne est survenue.' : message;
    const correlationId = request.id ?? 'unknown';

    if (status >= 500) {
      this.logger.error({ err: exception, correlationId, method: request.method, url: request.url }, 'Unhandled API exception');
    } else {
      this.logger.warn({ correlationId, status, method: request.method, url: request.url }, 'API request rejected');
    }

    void reply.status(status).send({
      error: {
        code: errorCode,
        message: safeMessage,
        correlationId,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}
