import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RiderGpsService } from "./rider-gps.service";
import { Public } from "../common/decorators";

/**
 * NF9 (FB4) — public rider share surface. No auth: the share
 * token in the URL IS the credential (the CX6 / ReportShare
 * pattern), resolved by SHA-256 hash in RiderGpsService. The
 * page behind these routes is /rider/[token] — it posts the
 * phone's geolocation ONLY while open, and says so honestly.
 */
@Controller("public/rider")
export class PublicRiderGpsController {
  constructor(private readonly gps: RiderGpsService) {}

  @Public()
  @Get(":token")
  resolve(@Param("token") token: string) {
    return this.gps.publicResolve(token);
  }

  @Public()
  @Post(":token/ping")
  ping(
    @Param("token") token: string,
    @Body() dto: { lat?: unknown; lng?: unknown; accuracy?: unknown; recordedAt?: unknown },
  ) {
    return this.gps.postPing(token, dto ?? {});
  }

  @Public()
  @Post(":token/stop")
  stop(@Param("token") token: string) {
    return this.gps.setSharing(token, false);
  }

  @Public()
  @Post(":token/start")
  start(@Param("token") token: string) {
    return this.gps.setSharing(token, true);
  }
}
