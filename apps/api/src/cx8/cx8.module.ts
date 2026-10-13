import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { LabelScanController, ProductRecognitionController } from "./cx8.controller";
import { LabelScanService } from "./label-scan.service";
import { ProductRecognitionService } from "./product-recognition.service";

/**
 * CX8 (Packing Label Scan + Image Product Recognition).
 * Self-contained module: both services read through Prisma directly
 * and take vision only from AiModule's VisionService — no edits to
 * the courier / inbox services were needed, and the recognition
 * service imports no send seam by design.
 */
@Module({
  imports: [AiModule],
  controllers: [LabelScanController, ProductRecognitionController],
  providers: [LabelScanService, ProductRecognitionService],
  exports: [LabelScanService, ProductRecognitionService],
})
export class Cx8Module {}
