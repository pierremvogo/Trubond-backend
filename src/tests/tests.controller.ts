import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessTokenGuard, CurrentAuth, AuthContext } from '../auth/auth.guard';

import { InvitationsService } from '../invitations/invitations.service';
import { CreateTestDto } from './dto/create-test.dto';
import { TestsService } from './tests.service';

@ApiTags('Tests')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('tests')
export class TestsController {
  constructor(
    private readonly testsService: TestsService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Créer un test TRUEBOND',
    description:
      'Crée un test à partir du numéro du destinataire ' +
      'et de la récompense. Les bonnes réponses proviennent ' +
      'des numéros vérifiés de l’initiateur.',
  })
  @ApiBody({ type: CreateTestDto })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateTestDto) {
    return this.testsService.create(auth.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Historique de mes tests envoyés',
  })
  list(@CurrentAuth() auth: AuthContext) {
    return this.testsService.listMine(auth.userId);
  }

  @Get('received')
  @ApiOperation({
    summary: 'Tests reçus et rattachés à mon compte',
  })
  listReceived(@CurrentAuth() auth: AuthContext) {
    return this.testsService.listReceived(auth.userId);
  }

  @Get(':id/invitation-link')
  @ApiOperation({
    summary: "Récupérer le lien d'invitation d'un test",
    description:
      "Retourne le lien sécurisé uniquement à l'initiateur " +
      "du test. Aucun message WhatsApp ou SMS n'est envoyé.",
  })
  invitationLink(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invitationsService.getInvitationLink(auth.userId, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détail d’un test autorisé',
  })
  detail(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.testsService.detail(auth.userId, id);
  }
}
