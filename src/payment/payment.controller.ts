import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermission } from '../common/permissions.decorator';
import { PaymentService } from './payment.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { UpdatePaymentTypeDto } from './dto/update-payment-type.dto';
import { paymentProofUploadOptions } from './payment-upload.config';

@Controller('api/payment')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Get('mine')
  @RequirePermission('payment', 'submit')
  mine(@Req() req: any) {
    return this.paymentService.mine((req.user as { userId: string }).userId);
  }

  @Post('mine/proof')
  @RequirePermission('payment', 'submit')
  @UseInterceptors(FileInterceptor('proof', paymentProofUploadOptions))
  uploadProof(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body('paymentId') paymentId?: string,
    @Body('senderName') senderName?: string,
    @Body('transferDate') transferDate?: string,
  ) {
    const proofUrl = `/api/uploads/payment-proofs/${file.filename}`;
    return this.paymentService.uploadProof(
      (req.user as { userId: string }).userId,
      paymentId,
      proofUrl,
      senderName,
      transferDate,
    );
  }

  @Get()
  @RequirePermission('payment', 'verify')
  listByConference(@Query('conferenceId', ParseUUIDPipe) conferenceId: string) {
    return this.paymentService.listByConference(conferenceId);
  }

  @Post(':paymentId/verify')
  @RequirePermission('payment', 'verify')
  verifyTeam(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: VerifyPaymentDto, @Req() req: any) {
    return this.paymentService.verifyTeam(paymentId, dto.action, dto.reason, (req.user as { userId: string }).userId);
  }

  @Post('participant/:attendanceId/verify')
  @RequirePermission('payment', 'verify')
  verifyParticipant(
    @Param('attendanceId', ParseUUIDPipe) attendanceId: string,
    @Body() dto: VerifyPaymentDto,
    @Req() req: any,
  ) {
    return this.paymentService.verifyParticipant(
      attendanceId,
      dto.action,
      dto.reason,
      (req.user as { userId: string }).userId,
    );
  }

  @Post(':paymentId/send-invoice')
  @RequirePermission('payment', 'verify')
  sendInvoiceTeam(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.paymentService.sendInvoiceTeam(paymentId);
  }

  @Post('participant/:attendanceId/send-invoice')
  @RequirePermission('payment', 'verify')
  sendInvoiceParticipant(@Param('attendanceId', ParseUUIDPipe) attendanceId: string) {
    return this.paymentService.sendInvoiceParticipant(attendanceId);
  }
}

@Controller('api/payment-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('payment', 'manage_types')
export class PaymentTypesController {
  constructor(private paymentService: PaymentService) {}

  @Get()
  list() {
    return this.paymentService.listPaymentTypes();
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePaymentTypeDto, @Req() req: any) {
    return this.paymentService.updatePaymentType(id, dto.uniqueCode, (req.user as { userId: string }).userId);
  }
}
