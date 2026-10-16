import { Module } from "@nestjs/common";
import { PublicDocsController } from "./public-docs.controller";
import { PublicDocsService } from "./public-docs.service";

/**
 * GC23 — public API docs. Leaf module: the service only reads
 * Nest metadata off the public controller CLASSES (imported for
 * their decorators, never instantiated here), so no module
 * imports are needed.
 */
@Module({
  controllers: [PublicDocsController],
  providers: [PublicDocsService],
  exports: [PublicDocsService],
})
export class PublicDocsModule {}
