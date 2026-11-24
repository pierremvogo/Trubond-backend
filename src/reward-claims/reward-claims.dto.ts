import { IsString, Matches, IsUUID } from 'class-validator';
export class ClaimAccessDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) accessToken!: string;
}
export class ClaimOtpRequestDto extends ClaimAccessDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) channelToken!: string;
}
export class ClaimDestinationDto extends ClaimOtpRequestDto {
  @IsString() @Matches(/^\+2376\d{8}$/) phone!: string;
}
export class ClaimOtpVerifyDto extends ClaimAccessDto {
  @IsUUID() challengeId!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
