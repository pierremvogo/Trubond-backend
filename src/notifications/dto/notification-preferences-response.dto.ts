import { ApiProperty } from '@nestjs/swagger';

export class NotificationPreferencesResponseDto {
  @ApiProperty({
    description: 'Activer les notifications push',
    example: true,
    default: true,
  })
  push!: boolean;

  @ApiProperty({
    description: 'Activer les notifications SMS',
    example: false,
    default: false,
  })
  sms!: boolean;

  @ApiProperty({
    description: 'Recevoir les résultats des tests',
    example: true,
    default: true,
  })
  results!: boolean;

  @ApiProperty({
    description: 'Recevoir les notifications de récompenses',
    example: true,
    default: true,
  })
  rewards!: boolean;

  @ApiProperty({
    description: 'Recevoir les rappels',
    example: true,
    default: true,
  })
  reminders!: boolean;

  @ApiProperty({
    description: 'Recevoir les actualités et offres',
    example: false,
    default: false,
  })
  news!: boolean;
}
