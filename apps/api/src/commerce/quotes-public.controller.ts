import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { QuotesService } from "./quotes.service";
import { Public } from "../common/decorators";
import { QuoteRespondDto } from "./commerce.dto";

/**
 * AB5 (AX7) public quote page API. All routes are @Public —
 * the unguessable token in the path is the only credential
 * (its SHA-256 hash is what's stored), exactly like the
 * public landing / review surfaces.
 */
@Controller("public/quote")
export class QuotesPublicController {
  constructor(private readonly quotes: QuotesService) {}

  @Public()
  @Get(":token")
  get(@Param("token") token: string) {
    return this.quotes.getByToken(token);
  }

  @Public()
  @Post(":token/respond")
  respond(@Param("token") token: string, @Body() dto: QuoteRespondDto) {
    return this.quotes.publicRespond(token, dto ?? ({} as QuoteRespondDto));
  }
}
