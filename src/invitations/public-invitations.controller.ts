import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';

import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { InvitationsService } from './invitations.service';

type SubmitAnswerBody = {
  token?: string;
  phone?: string;
};

@ApiTags('Public Invitations')
@Controller('invitations')
export class PublicInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('resolve')
  @ApiOperation({
    summary: 'Consulter une invitation TRUEBOND',
    description:
      'Route publique permettant au destinataire ' +
      'de consulter les informations de son invitation. ' +
      "Aucune authentification n'est requise.",
  })
  @ApiQuery({
    name: 'token',
    required: true,
    type: String,
    description: "Token sécurisé de l'invitation",
  })
  resolveInvitation(@Query('token') token?: string) {
    if (!token) {
      throw new BadRequestException("Le token d'invitation est obligatoire");
    }

    return this.invitationsService.resolveInvitation(token);
  }

  @Post('submit-answer')
  @ApiOperation({
    summary: 'Soumettre la réponse à un test TRUEBOND',
    description:
      'Route publique permettant au destinataire ' +
      'de soumettre un numéro de téléphone comme réponse. ' +
      "Le token d'invitation autorise une seule réponse définitive. " +
      "Aucune authentification n'est requise.",
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'phone'],
      properties: {
        token: {
          type: 'string',
          description: "Token sécurisé de l'invitation",
        },
        phone: {
          type: 'string',
          description: 'Numéro saisi par le destinataire au format E.164',
          example: '+2376XXXXXXXX',
        },
      },
    },
  })
  submitAnswer(@Body() body: SubmitAnswerBody) {
    if (!body || typeof body.token !== 'string' || !body.token.trim()) {
      throw new BadRequestException("Le token d'invitation est obligatoire");
    }

    if (typeof body.phone !== 'string' || !body.phone.trim()) {
      throw new BadRequestException('Le numéro de téléphone est obligatoire');
    }

    return this.invitationsService.submitAnswer(body.token, body.phone);
  }
}
