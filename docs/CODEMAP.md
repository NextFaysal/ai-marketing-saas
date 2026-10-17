# Code Map — apps/api modules

The API is a modular monolith: **78 feature modules** under `apps/api/src/`, each typically
`<name>.module.ts / .controller.ts / .service.ts / .dto.ts` plus `*.spec.ts` tests.
This map groups them by business domain **without moving any file** (a physical move is a separate, gated refactor).

## Platform & Core (15)

`admin`, `auth`, `organizations`, `audit`, `health`, `common`, `prisma`, `storage`, `data-tools`, `imports`, `translations`, `merchant-api`, `public-docs`, `webhooks-outgoing`, `webpush`

## Commerce Core (18)

`commerce`, `orders`, `order-automation`, `order-notifications`, `products`, `catalogs`, `inventory`, `warehouse`, `fulfillment`, `delivery`, `courier`, `pos`, `storefront`, `landings`, `subscriptions`, `installments`, `purchasing`, `dropship`

## Money (7)

`payments`, `accounting`, `finance`, `tax`, `reconciliation`, `portfolio`, `affiliates`

## Marketing & Ads (18)

`campaigns`, `ads`, `audiences`, `creatives`, `analytics`, `attribution`, `conversions`, `offline-conversions`, `reports`, `tracking`, `social`, `publishing`, `feeds`, `live-commerce`, `video-studio`, `gamified-promotions`, `social-proof`, `competitors`

## Customer & Messaging (12)

`inbox`, `messaging`, `crm`, `customers`, `support`, `cx8`, `automation`, `workflows`, `voice`, `booking`, `feedback`, `membership`

## AI & Risk (4)

`ai`, `knowledge`, `fraud`, `fraud-network`

## Business Ops & Integrations (4)

`agency`, `hr`, `connections`, `integrations`
