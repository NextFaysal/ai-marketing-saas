import { Controller, Get, UseGuards } from "@nestjs/common";
import { SuperAdminGuard, AdminTier } from "../common/super-admin.guard";
import { AdminTranslationsCoverageService } from "./admin-translations.service";

/**
 * MB5 (ML15) — the platform translation-coverage board's API.
 *
 * Same guard pattern as the neighbouring AdminAiController:
 * SUPER tier only, reads included — a tenant user (incl. an org
 * OWNER) is not a platform admin, so the SuperAdminGuard's
 * live-row check refuses them before any handler runs. The
 * board itself returns counts + org identity only, never
 * translation text.
 */
@Controller("admin/translations")
@UseGuards(SuperAdminGuard)
@AdminTier("SUPER")
export class AdminTranslationsController {
  constructor(private readonly coverageService: AdminTranslationsCoverageService) {}

  /** Cross-org ContentTranslation coverage: per-org rows +
   * platform totals, per content locale (bn/en/hi). */
  @Get("coverage")
  coverage() {
    return this.coverageService.coverage();
  }
}
