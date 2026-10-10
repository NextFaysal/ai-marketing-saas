import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators";
@Controller("health")
export class HealthController {
  @Public() @Get()
  check() { return { status: "ok", service: "api", timestamp: new Date().toISOString() }; }
}
