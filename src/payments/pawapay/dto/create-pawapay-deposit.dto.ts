import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

export class CreatePawapayDepositDto {
  @ApiProperty({
    enum: ['MTN_MOMO_CMR', 'ORANGE_CMR'],
    example: 'MTN_MOMO_CMR',
  })
  @IsString()
  @IsIn(['MTN_MOMO_CMR', 'ORANGE_CMR'])
  correspondent!: 'MTN_MOMO_CMR' | 'ORANGE_CMR';

  @ApiProperty({
    description: 'Numéro Mobile Money camerounais au format 2376XXXXXXXX',
    example: '2376XXXXXXXX',
  })
  @IsString()
  @Matches(/^2376\d{8}$/, {
    message: 'Le numéro doit être au format 2376XXXXXXXX',
  })
  phoneNumber!: string;
}
