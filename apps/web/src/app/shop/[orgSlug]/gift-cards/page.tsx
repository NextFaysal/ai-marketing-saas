import React from "react";
import { GiftCardBalanceClient } from "./GiftCardBalanceClient";

// AB2 (AX3) — public gift-card balance page (server wrapper,
// the form is the client component beside it — the PDP pattern).
export default async function ShopGiftCardsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  return <GiftCardBalanceClient orgSlug={orgSlug} />;
}
