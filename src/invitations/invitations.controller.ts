import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessTokenGuard, CurrentAuth, AuthContext } from '../auth/auth.guard';

import { InvitationsService } from './invitations.service';

@ApiTags('Invitations')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('tests')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get(':id/invitation-link')
  @ApiOperation({
    summary: "Récupérer le lien d'invitation d'un test",
    description:
      "Accessible uniquement à l'initiateur. " + "Aucun SMS ni message WhatsApp n'est envoyé.",
  })
  getInvitationLink(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.invitationsService.getInvitationLink(auth.userId, id);
  }
}
