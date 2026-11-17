import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessTokenGuard, CurrentAuth, AuthContext } from '../../auth/auth.guard';

import { PawapayDepositsService } from './pawapay-deposits.service';
import { CreatePawapayDepositDto } from './dto/create-pawapay-deposit.dto';

@ApiTags('Payments - pawaPay')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('tests/:id/pawapay')
export class PawapayDepositsController {
  constructor(private readonly deposits: PawapayDepositsService) {}

  @Post('quote')
  @ApiOperation({
    summary: 'Calculer le devis du dépôt pawaPay',
  })
  quote(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) testId: string) {
    return this.deposits.quoteDeposit(auth.userId, testId);
  }

  @Post('reserve')
  @ApiOperation({
    summary: 'Réserver un dépôt pawaPay',
  })
  reserve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) testId: string,
    @Body() dto: CreatePawapayDepositDto,
  ) {
    return this.deposits.reserveDeposit(auth.userId, testId, dto);
  }

  @Post('initiate')
  @ApiOperation({
    summary: 'Initier un dépôt pawaPay Sandbox',
  })
  initiate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) testId: string) {
    return this.deposits.initiateDeposit(auth.userId, testId);
  }
}
