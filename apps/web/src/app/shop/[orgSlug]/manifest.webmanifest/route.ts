import { fetchShopHome } from "@/lib/storefront-server";
import { buildShopManifest } from "@/lib/shop-pwa";

/**
 * AB8 (AX22) — per-shop PWA manifest, served at
 * /shop/[orgSlug]/manifest.webmanifest.
 *
 * Thin wrapper over the pure buildShopManifest (lib/shop-pwa):
 * the shop's own name, colors and icon — a white-label shop
 * never advertises the platform identity. AX22 adds NO service
 * worker; installability metadata only.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug);
  if (!home) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }
  return new Response(JSON.stringify(buildShopManifest(home, orgSlug)), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
