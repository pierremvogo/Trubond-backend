import { Body, Controller, Header, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RewardClaimsService } from './reward-claims.service';
import {
  ClaimAccessDto,
  ClaimOtpRequestDto,
  ClaimDestinationDto,
  ClaimOtpVerifyDto,
} from './reward-claims.dto';
@ApiTags('Reward Claims')
@Controller('reward-claims')
export class RewardClaimsController {
  constructor(private readonly claims: RewardClaimsService) {}
  @Post('resolve')
  @Header('Cache-Control', 'no-store')
  resolve(@Body() dto: ClaimAccessDto) {
    return this.claims.resolveAccess(dto.accessToken);
  }
  @Post('identity/request-otp')
  @Header('Cache-Control', 'no-store')
  requestIdentity(@Body() dto: ClaimOtpRequestDto) {
    return this.claims.requestIdentityOtp(dto.accessToken, dto.channelToken);
  }
  @Post('identity/verify-otp')
  @Header('Cache-Control', 'no-store')
  verifyIdentity(@Body() dto: ClaimOtpVerifyDto) {
    return this.claims.verifyIdentityOtp(dto.accessToken, dto.challengeId, dto.code);
  }
  @Post('destination/request-otp')
  @Header('Cache-Control', 'no-store')
  requestDestination(@Body() dto: ClaimDestinationDto) {
    return this.claims.requestDestinationOtp(dto.accessToken, dto.phone, dto.channelToken);
  }
  @Post('destination/verify-otp')
  @Header('Cache-Control', 'no-store')
  verifyDestination(@Body() dto: ClaimOtpVerifyDto) {
    return this.claims.verifyDestinationOtp(dto.accessToken, dto.challengeId, dto.code);
  }
}
