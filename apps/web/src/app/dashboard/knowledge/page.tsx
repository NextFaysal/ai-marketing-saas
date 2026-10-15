import { redirect } from "next/navigation";

/**
 * Business Knowledge moved into Organization Settings (owner decision
 * 2026-10-15: it is not used regularly, so it should not be a
 * top-level page). This route only redirects so old bookmarks and
 * links land on the Business Knowledge section of the settings page
 * instead of 404ing.
 */
export default function KnowledgePage() {
  redirect("/dashboard/settings#hub-knowledge");
}
