# Milestone 3 Acceptance Checklist - WooCommerce Integration

- [x] Prisma models: Store, Integration, IntegrationCredential, SyncJob,
      WebhookEvent, Customer, Order, OrderItem + migration
      20261010020000_milestone3. Schema total: 22 models.
- [x] Credential security: consumer key/secret + webhook secret stored
      only as AES-256-GCM ciphertext (`ENCRYPTION_KEY`, 32 bytes).
      Plaintext never in DB, logs or API responses (test asserts this).
      Production refuses to boot credential features without the key.
- [x] Connect flow: credentials are tested against the real WooCommerce
      API (`/system_status`) BEFORE anything is saved. Failed test =
      nothing persisted, clear error to the user.
- [x] WooCommerce adapter: WooClient (Basic auth over HTTPS, secret never
      in URL), pagination from WP headers, WooApiError on HTTP errors.
      Normalized behind internal interfaces so Shopify can reuse the
      store/order models later.
- [x] Product sync: upsert by (organization, source, externalId);
      re-sync updates, never duplicates; SKU collision with a manual
      product degrades to creating without SKU instead of failing;
      variable products sync variations; incremental via productsCursor;
      max 1000 records per manual run, SyncJob records counts.
- [x] Order sync: upsert by (organization, source, externalId); customer
      matched by store external id then email, within the org only;
      items fully replaced from source payload; product linking by
      external id then SKU; COD detection (cod / cash_on_delivery);
      refunds stored as positive amounts.
- [x] Order status handling: raw platform status preserved
      (pending/processing/on-hold/completed/cancelled/refunded/failed).
      Delivered revenue counts completed orders only.
- [x] Webhooks: POST /webhooks/woocommerce/:integrationId, HMAC-SHA256
      signature verified with timing-safe compare (rawBody enabled),
      secret required, duplicate delivery ids acknowledged without
      reprocessing, processing failures recorded on the WebhookEvent.
- [x] Orders API + stats: list with status / COD filters, detail, and
      stats (totals, COD count + share, delivered revenue, by-status).
- [x] Web: Stores & Integrations page (2-step connect with WP-Admin
      instructions, status, last sync + error, sync buttons, webhook URL,
      disconnect), Orders page (filters, COD badge, stats cards).
- [x] Tests: 43 total passing (API 35, contracts 7, worker 1), including
      encryption round-trip/tamper, client auth/URL, normalizers,
      signature verification, tenant-scoped idempotent upserts.
- [x] Builds: all packages + API + Next.js (15 routes) pass.
- [ ] Verified against a real WooCommerce store + live Postgres
      (requires user's store credentials; see manual test script below)

## Manual live test (on the user's machine)
1. Run the Milestone 1/2 quick start (Docker, migrate, seed, dev servers).
2. Create a store, then connect with keys from WP Admin > WooCommerce >
   Settings > Advanced > REST API (Read/Write).
3. Sync Products: check counts against WP Admin product count.
4. Sync Orders: check a known COD order appears with the COD badge.
5. Create a webhook (Order updated) with the shown URL and the same
   secret used at connect; change an order status in Woo and confirm the
   dashboard reflects it exactly once.

## Known limitations
- Sync is triggered manually (button) in this milestone; scheduled
  background sync uses the already-defined BullMQ `sync-store` queue and
  is scheduled with the worker expansion.
- Only products/orders/customers sync. Coupons and store settings are
  not synced yet; fields a store does not expose stay empty rather than
  being guessed.
- Shopify adapter reuses these models; planned for Phase 10 expansion.
