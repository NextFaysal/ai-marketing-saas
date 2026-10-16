import { Controller, Get, Header } from "@nestjs/common";
import { PublicDocsService } from "./public-docs.service";
import { Public } from "../common/decorators";

/**
 * GC23 — the public API's own documentation endpoints. Both are
 * @Public (the documentation of a public API is itself public).
 */
@Controller("public/docs")
export class PublicDocsController {
  constructor(private readonly docs: PublicDocsService) {}

  @Public()
  @Get("openapi.json")
  openapi() {
    return this.docs.getOpenApiDoc();
  }

  @Public()
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  index() {
    return this.docs.getDocsHtml();
  }
}
