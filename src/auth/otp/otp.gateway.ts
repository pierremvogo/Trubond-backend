import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { DevOtpChannelService } from './dev-otp-channel.service';

@Injectable()
@WebSocketGateway({
  namespace: '/otp-dev',
  cors: {
    origin: false,
  },
})
export class OtpGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Namespace;

  constructor(private readonly channels: DevOtpChannelService) {}

  async handleConnection(client: Socket): Promise<void> {
    const rawToken: unknown = client.handshake.auth?.token;

    if (typeof rawToken !== 'string' || !this.channels.isValid(rawToken)) {
      client.disconnect(true);
      return;
    }

    await client.join(`otp:${rawToken}`);

    client.emit('otp:ready', {
      connected: true,
    });
  }
  async sendOtp(token: string, code: string, challengeId: string): Promise<void> {
    if (!this.channels.isValid(token)) {
      throw new Error('Canal OTP de test invalide');
    }

    const room = `otp:${token}`;
    const sockets = await this.server.in(room).fetchSockets();

    if (sockets.length === 0) {
      throw new Error('Aucune application mobile connectée au canal OTP');
    }

    this.server.to(room).emit('otp:received', {
      challengeId,
      code,
      expiresInSeconds: 300,
    });
  }
}
