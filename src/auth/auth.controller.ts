import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthService } from './auth.service';

import { AccessTokenGuard, CurrentAuth, AuthContext } from './auth.guard';

import {
  ChangePasswordDto,
  DeleteAccountDto,
  LoginDto,
  PhoneDto,
  RefreshDto,
  RegisterDto,
  ResetDto,
  VerifyDto,
} from './auth.dto';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  /**
   * 1. INSCRIPTION
   *
   * Crée un compte et demande un OTP.
   * En développement : Socket.IO.
   * Sinon : fournisseur SMS configuré.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Créer un compte et envoyer un OTP',
  })
  @ApiHeader({
    name: 'x-dev-otp-channel',
    required: false,
    description: 'Token du canal Socket.IO pour les tests OTP en développement uniquement.',
  })
  @ApiResponse({
    status: 201,
    description: 'Compte créé, vérification OTP requise',
  })
  register(
    @Body() dto: RegisterDto,
    @Headers('x-dev-otp-channel')
    channelToken?: string,
  ) {
    return this.service.register(dto, channelToken);
  }

  /**
   * 2. CONFIRMATION DE L'INSCRIPTION
   *
   * Vérifie l'OTP et crée une session.
   */
  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirmer l'inscription avec un OTP",
  })
  @ApiResponse({
    status: 200,
    description: 'Compte confirmé, tokens générés',
  })
  confirm(@Body() dto: VerifyDto) {
    return this.service.verifySignup(dto);
  }

  /**
   * 3. CONNEXION
   *
   * Vérifie le mot de passe et demande un OTP.
   */

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion par téléphone et mot de passe',
  })
  @ApiResponse({
    status: 200,
    description: 'Connexion réussie, tokens de session retournés',
  })
  @ApiResponse({
    status: 401,
    description: 'Numéro de téléphone ou mot de passe incorrect',
  })
  @ApiResponse({
    status: 403,
    description: 'Compte inactif ou non autorisé',
  })
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  /**
   * 4. VÉRIFICATION OTP DE CONNEXION
   *
   * Vérifie l'OTP et retourne les tokens.
   */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Valider le code OTP de connexion',
  })
  @ApiResponse({
    status: 200,
    description: 'Connexion validée, tokens générés',
  })
  verify(@Body() dto: VerifyDto) {
    return this.service.verifyLogin(dto);
  }

  /**
   * 5. MOT DE PASSE OUBLIÉ
   *
   * Demande un OTP de réinitialisation.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Demander un OTP de réinitialisation',
  })
  @ApiHeader({
    name: 'x-dev-otp-channel',
    required: false,
    description: 'Token du canal Socket.IO pour recevoir l’OTP en développement.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demande de réinitialisation traitée',
  })
  forgot(
    @Body() dto: PhoneDto,
    @Headers('x-dev-otp-channel')
    channelToken?: string,
  ) {
    return this.service.forgotPassword(dto.phone, channelToken);
  }

  /**
   * 6. RÉINITIALISATION DU MOT DE PASSE
   *
   * Vérifie l'OTP et modifie le mot de passe.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser le mot de passe avec OTP',
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé',
  })
  reset(@Body() dto: ResetDto) {
    return this.service.resetPassword(dto);
  }

  /**
   * 7. RENOUVELLEMENT DES TOKENS
   *
   * Rotation du refresh token.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler les tokens de connexion',
  })
  @ApiResponse({
    status: 200,
    description: 'Nouveaux tokens générés',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.service.refresh(dto.refreshToken);
  }

  /**
   * 8. PROFIL UTILISATEUR
   *
   * Nécessite un access token valide.
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'Récupérer le profil courant',
  })
  @ApiResponse({
    status: 200,
    description: 'Profil utilisateur',
  })
  me(@CurrentAuth() auth: AuthContext) {
    return this.service.me(auth.userId);
  }

  /**
   * 9. CHANGEMENT DU MOT DE PASSE
   *
   * Nécessite une session active.
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modifier le mot de passe',
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe modifié',
  })
  change(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(auth.userId, dto);
  }

  /**
   * 10. DÉCONNEXION
   *
   * Révoque la famille de sessions courante.
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Déconnecter la session courante',
  })
  @ApiResponse({
    status: 200,
    description: 'Session révoquée',
  })
  logout(@CurrentAuth() auth: AuthContext) {
    return this.service.logout(auth.userId, auth.familyId);
  }

  /**
   * 11. DÉCONNEXION DE TOUS LES APPAREILS
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Déconnecter tous les appareils',
  })
  @ApiResponse({
    status: 200,
    description: 'Toutes les sessions ont été révoquées',
  })
  logoutAll(@CurrentAuth() auth: AuthContext) {
    return this.service.logoutAll(auth.userId);
  }

  /**
   * 12. DEMANDE DE SUPPRESSION DE COMPTE
   *
   * Demande un OTP de suppression.
   * Nécessite une session active.
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post('account/delete/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Demander un OTP de suppression de compte',
  })
  @ApiHeader({
    name: 'x-dev-otp-channel',
    required: false,
    description: 'Token du canal Socket.IO pour recevoir l’OTP en développement.',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP de suppression demandé',
  })
  deleteRequest(
    @CurrentAuth() auth: AuthContext,
    @Headers('x-dev-otp-channel')
    channelToken?: string,
  ) {
    return this.service.requestDelete(auth.userId, channelToken);
  }

  /**
   * 13. SUPPRESSION DU COMPTE
   *
   * Vérifie le mot de passe et l'OTP,
   * puis désactive le compte.
   */
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Désactiver le compte avec OTP et mot de passe',
  })
  @ApiResponse({
    status: 200,
    description: 'Compte désactivé',
  })
  deleteAccount(@CurrentAuth() auth: AuthContext, @Body() dto: DeleteAccountDto) {
    return this.service.deleteAccount(auth.userId, dto);
  }
}
