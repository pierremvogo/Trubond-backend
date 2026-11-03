import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
export class PhoneDto {
  @ApiProperty({
    description: 'Numéro de téléphone au format E.164',
    example: '+237690000000',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le numéro doit être au format E.164, ex. +237690000000',
  })
  phone!: string;
}
export class RegisterDto extends PhoneDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'CM' })
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiPropertyOptional({
    description: 'Jusqu’à deux numéros supplémentaires au format E.164',
    type: [String],
    maxItems: 2,
    example: ['+237699887766', '+237655443322'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^\+[1-9]\d{7,14}$/, {
    each: true,
    message: 'Chaque numéro supplémentaire doit être au format E.164',
  })
  additionalPhones?: string[];
}
export class LoginDto extends PhoneDto {
  @ApiProperty() @IsString() password!: string;
}
export class VerifyDto {
  @ApiProperty() @IsUUID() challengeId!: string;
  @ApiProperty() @Matches(/^\d{6}$/) code!: string;
}
export class ResendDto {
  @ApiProperty() @IsUUID() challengeId!: string;
}
export class ResetDto extends VerifyDto {
  @ApiProperty({ minLength: 8 }) @MinLength(8) newPassword!: string;
}
export class ChangePasswordDto {
  @ApiProperty() @IsString() oldPassword!: string;
  @ApiProperty({ minLength: 8 }) @MinLength(8) newPassword!: string;
}
export class RefreshDto {
  @ApiProperty() @IsString() refreshToken!: string;
}
export class DeleteAccountDto {
  @ApiProperty({
    description: 'Mot de passe actuel du compte',
    example: 'MonMotDePasse',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
