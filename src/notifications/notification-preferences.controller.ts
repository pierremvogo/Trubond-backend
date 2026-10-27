import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccessTokenGuard, CurrentAuth, AuthContext } from '../auth/auth.guard';

import { NotificationPreferencesService } from './notification-preferences.service';

import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

import { NotificationPreferencesResponseDto } from './dto/notification-preferences-response.dto';

@ApiTags('Préférences des notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  // ==========================================
  // GET /api/notifications/preferences
  // ==========================================

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Récupérer mes préférences de notifications',
    description:
      'Retourne les préférences de notifications de ' +
      "l'utilisateur authentifié. " +
      'Si aucune préférence n’a encore été enregistrée, ' +
      'les valeurs par défaut sont retournées.',
  })
  @ApiOkResponse({
    description: 'Préférences récupérées avec succès.',
    type: NotificationPreferencesResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Access token absent, invalide ou expiré.',
  })
  @ApiForbiddenResponse({
    description: 'Accès refusé à cette ressource.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Erreur interne du serveur.',
  })
  findMine(@CurrentAuth() auth: AuthContext): Promise<NotificationPreferencesResponseDto> {
    return this.service.findMine(auth.userId);
  }

  // ==========================================
  // PATCH /api/notifications/preferences
  // ==========================================

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modifier mes préférences de notifications',
    description:
      'Met à jour une ou plusieurs préférences ' +
      "de l'utilisateur authentifié. " +
      'Seuls les champs fournis sont modifiés. ' +
      'Les préférences de sécurité essentielles ' +
      'ne sont pas désactivables via cet endpoint.',
  })
  @ApiBody({
    description: 'Préférences à modifier. Tous les champs sont facultatifs.',
    type: UpdateNotificationPreferencesDto,
    examples: {
      enableSms: {
        summary: 'Activer les SMS',
        value: {
          sms: true,
        },
      },
      disablePush: {
        summary: 'Désactiver les notifications push',
        value: {
          push: false,
        },
      },
      updateCategories: {
        summary: 'Modifier plusieurs catégories',
        value: {
          results: true,
          rewards: true,
          reminders: false,
          news: false,
        },
      },
      updateAll: {
        summary: 'Modifier toutes les préférences',
        value: {
          push: true,
          sms: false,
          results: true,
          rewards: true,
          reminders: true,
          news: false,
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Préférences mises à jour avec succès.',
    type: NotificationPreferencesResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Données invalides : les préférences doivent être ' + 'des valeurs booléennes.',
  })
  @ApiUnauthorizedResponse({
    description: 'Access token absent, invalide ou expiré.',
  })
  @ApiForbiddenResponse({
    description: 'Accès refusé à cette ressource.',
  })
  @ApiInternalServerErrorResponse({
    description: 'Erreur interne du serveur.',
  })
  updateMine(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    return this.service.updateMine(auth.userId, dto);
  }
}
