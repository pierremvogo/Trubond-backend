import { BadRequestException, Controller, Get, Query } from '@nestjs/common';

import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { InvitationsService } from './invitations.service';

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
}
