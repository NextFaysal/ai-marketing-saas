import { fetchShopHome } from "@/lib/storefront-server";
import { buildShopIconSvg } from "@/lib/shop-pwa";

/**
 * AB8 (AX22) — neutral generated shop icon, served at
 * /shop/[orgSlug]/icon.svg.
 *
 * A rounded square in the shop's primary color with its first
 * letter — the white-label fallback icon, so a white-label shop
 * without a logo never renders the platform's mark.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug);
  if (!home) {
    return new Response("Shop not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(buildShopIconSvg(home), {
    headers: { "Content-Type": "image/svg+xml" },
  });
}
