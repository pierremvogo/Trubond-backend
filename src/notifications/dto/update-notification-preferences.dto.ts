import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({
    description: 'Activer ou désactiver les notifications push',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({
    description: 'Activer ou désactiver les notifications SMS',
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @ApiPropertyOptional({
    description: 'Recevoir les résultats des tests',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  results?: boolean;

  @ApiPropertyOptional({
    description: 'Recevoir les notifications de récompenses',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  rewards?: boolean;

  @ApiPropertyOptional({
    description: 'Recevoir les rappels',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  reminders?: boolean;

  @ApiPropertyOptional({
    description: 'Recevoir les actualités et offres',
    example: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  news?: boolean;
}
