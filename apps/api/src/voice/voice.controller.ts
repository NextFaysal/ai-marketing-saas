import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response, Request } from "express";
import { VoiceService } from "./voice.service";
import {
  InitiateVoiceCallDto,
  SimulateCallReplyDto,
  VoiceCallSettingDto,
} from "./voice.types";
import { CurrentUser, AuthUser, Roles, PermissionArea, Public } from "../common/decorators";
import { TenantGuard } from "../common/tenant.guard";
import { RolesGuard } from "../common/roles.guard";

const MANAGE_ROLES = ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"] as const;

@PermissionArea("orders")
@Controller("organizations/:organizationId")
@UseGuards(TenantGuard, RolesGuard)
export class VoiceTenantController {
  constructor(private readonly voiceService: VoiceService) {}

  @Get("voice/settings")
  @Roles(...MANAGE_ROLES)
  getSettings(@Param("organizationId") orgId: string) {
    return this.voiceService.getSettings(orgId);
  }

  @Put("voice/settings")
  @Roles("OWNER", "ADMIN")
  updateSettings(
    @Param("organizationId") orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VoiceCallSettingDto,
  ) {
    return this.voiceService.updateSettings(orgId, user.userId, dto);
  }

  @Post("orders/:orderId/voice-call")
  @Roles(...MANAGE_ROLES)
  initiateCall(
    @Param("organizationId") orgId: string,
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto?: InitiateVoiceCallDto,
  ) {
    return this.voiceService.initiateCall(orgId, orderId, user.userId, dto);
  }

  @Get("orders/:orderId/voice-calls")
  @Roles(...MANAGE_ROLES)
  getCalls(
    @Param("organizationId") orgId: string,
    @Param("orderId") orderId: string,
  ) {
    return this.voiceService.getCallsForOrder(orgId, orderId);
  }

  @Post("voice/calls/:callId/simulate")
  @Roles(...MANAGE_ROLES)
  simulateCall(
    @Param("organizationId") _orgId: string,
    @Param("callId") callId: string,
    @Body() dto: SimulateCallReplyDto,
  ) {
    return this.voiceService.simulateCustomerResponse(callId, dto.digitsPressed);
  }
}

/**
 * Public Webhook controller for Twilio Voice integration
 */
@Controller("voice")
export class VoiceWebhookController {
  constructor(private readonly voiceService: VoiceService) {}

  @Public()
  @Get("twiml/:callId")
  @Header("Content-Type", "text/xml; charset=utf-8")
  async getTwiml(
    @Param("callId") callId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const protocol = req.protocol || "https";
    const host = req.get("host") || "localhost:4000";
    const baseUrl = `${protocol}://${host}`;
    const xml = await this.voiceService.generateTwiml(callId, baseUrl);
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.send(xml);
  }

  @Public()
  @Post("webhook/gather/:callId")
  @Header("Content-Type", "text/xml; charset=utf-8")
  async handleGather(
    @Param("callId") callId: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const digits = body?.Digits ?? body?.digits;
    const result = await this.voiceService.handleGatherResult(callId, digits);
    res.setHeader("Content-Type", "text/xml; charset=utf-8");
    res.send(result.xml);
  }

  @Public()
  @Post("webhook/status/:callId")
  async handleStatus(
    @Param("callId") callId: string,
    @Body() body: any,
  ) {
    const status = body?.CallStatus || body?.status || "completed";
    const duration = body?.CallDuration || body?.durationSeconds;
    const recordingUrl = body?.RecordingUrl;
    return this.voiceService.handleStatusCallback(callId, status, duration, recordingUrl);
  }
}
