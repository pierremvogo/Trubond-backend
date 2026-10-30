import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Min } from 'class-validator';

export class CreateTestDto {
  @ApiProperty({
    example: '+237677123456',
    description: 'Numéro international du destinataire',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le numéro doit être au format international E.164',
  })
  recipientPhone!: string;

  @ApiProperty({
    example: 20000,
    description: 'Récompense en FCFA',
  })
  @IsInt()
  @Min(1)
  rewardXaf!: number;
}
