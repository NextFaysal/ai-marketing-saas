import { Body, Controller, Post } from "@nestjs/common";
import { TrackingService } from "./tracking.service";
import { IngestDto } from "./tracking.dto";
import { Public } from "../common/decorators";

// Public ingestion endpoint used by tracker.js. Identification is the
// store's public tracking key; no customer secrets are involved. Events
// are validated, deduplicated and size-limited in the service.
@Controller("tracking")
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}
  @Public() @Post("events")
  ingest(@Body() dto: IngestDto) { return this.tracking.ingest(dto); }
}
