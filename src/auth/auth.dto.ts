import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
export class PhoneDto {
  @ApiProperty({ example: '+237690000000' }) @Matches(/^\+[1-9]\d{7,14}$/) phone!: string;
}
export class RegisterDto extends PhoneDto {
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
  @ApiProperty({ example: 'CM' }) @Matches(/^[A-Z]{2}$/) countryCode!: string;
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
  @ApiProperty() @IsString() password!: string;
  @ApiProperty() @IsUUID() challengeId!: string;
  @ApiProperty() @Matches(/^\d{6}$/) code!: string;
}
