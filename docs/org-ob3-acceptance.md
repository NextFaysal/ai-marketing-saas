# Organization Next — Batch OB3 Acceptance (ORG9 + ORG10)

তারিখ: 2026-10-17 · Worktree: `~/workspace/ai-marketing-saas-org`, branch `org-next`, base `be70184e` (OB1+OB2 complete, tree clean)।
সূত্র পরিকল্পনা: `Organization-Next-Plan-2026-10-16.md` গুচ্ছ C (সদস্য বাড়ার পথ)।
Local commits only — **কোনো push হয়নি**।
Migration claim (ledger যাচাই করে): এই tree-তে সর্বশেষ `20261021000000_org_archive`; **`20261022000000_org_invite_link`** (ORG9) ও **`20261023000000_org_join_request`** (ORG10) দুটোই ফাঁকা ছিল — এই ব্যাচে নেওয়া হলো।

## Inventory — এই batch শুরুর আগে পড়ে যাচাই করা

### MemberInvitation মডেল ও M34 accept flow (ORG9/ORG10-এর ভিত্তি)
- মডেল (schema ~6179): `id, organizationId, email, role Role @default(VIEWER), tokenHash @unique, status String ("pending"|"accepted"|"revoked"), invitedById, expiresAt, acceptedAt?, acceptedUserId?, emailSent, createdAt, updatedAt` — **Prisma relation নেই**, শুধু scalar `organizationId` (Organization মডেলেও back-relation নেই)। নতুন দুটো মডেলও এই একই ধাঁচে (plain scalar) বানানো হবে।
- Token শৃঙ্খলা: raw = `randomBytes(24).toString("base64url")`; সংরক্ষণে শুধু `hashInviteToken()` = SHA-256 hex; raw link আমন্ত্রণকারীকে **একবার** ফেরত দেওয়া হয়। মেয়াদ 7 দিন (`Date.now() + 7*24*3600*1000`)।
- `InvitationsController` (`invitations` prefix): global JWT guard — **deliberately TenantGuard ছাড়া** (আমন্ত্রিত এখনো সদস্য নয়)। `@Public()` decorator আছে (`common/decorators.ts`, `IS_PUBLIC_KEY`) এবং global `JwtAuthGuard` তা মানে (সত্যিকারের লগইন-ছাড়া route সম্ভব) — PublicBrandingController-এ ব্যবহৃত ধাঁচ।
- Accept: `getInvitationForUser` (ইমেইল-মিলই নিরাপত্তা নিয়ম) + `acceptInvitation` — status যাচাই (revoked/accepted/expired), ইমেইল অমিলে Forbidden, ইতিমধ্যে সদস্য হলে invitation cleanly close, তারপর `seatGuard(orgId, inv.id)` ডেকে membership create + audit `org.invite_accepted`।

### seatGuard — অবস্থান ও নিয়ম
- `OrganizationsService.seatGuard()` (private, service:353): platform-settings থেকে org-এর override (`Organization.seatLimit`) → না থাকলে plan-এর seats (`DEFAULT_PLAN_LIMITS`: FREE 2 / STARTER 5 / GROWTH 10 / AGENCY 50; orgPlan = সর্বশেষ subscription row)।
- গোনে: ACTIVE membership + pending (মেয়াদোত্তীর্ণ নয়) **MemberInvitation**; সীমা পূর্ণ হলে পণ্যের কণ্ঠে BadRequest। Accept-এর সময় `excludeInvitationId` দিয়ে নিজের invitation বাদ (M34 live-found বাগের সংশোধন)।
- ORG10 approve এই **একই private মেথডটাই** ডাকবে (দ্বিতীয় কপি নয়)। সচেতন সিদ্ধান্ত: pending **join request seat ধরে রাখে না** — guard শুধু approve-এর মুহূর্তে চলে, তাই আগে approve হওয়া অনুরোধই seat পায়; queue-তে পেন্ডিং অনুরোধ জমে থাকলেও অতিরিক্ত সদস্য তৈরি অসম্ভব (approve-ই একমাত্র সদস্য-তৈরির ধাপ)।

### Controller/DTO ধাঁচ
- Org-scoped সুরক্ষিত route: `@PermissionArea("team")` + `@UseGuards(TenantGuard, RolesGuard)` + `@Roles("OWNER","ADMIN")` — invitations route-গুলো হুবহু এই ধাঁচের। নতুন invite-link ও join-request queue route-ও তাই হবে (TenantGuard-এর archived-org বাধা OB1 অনুযায়ী স্বয়ংক্রিয়ভাবে প্রযোজ্য)।
- Service স্তরে actor যাচাই: `memberOrThrow(orgId, userId)` (membership না থাকলে 404) + role পরীক্ষা — ORG1/ORG5-এ এই দ্বিতীয় স্তর ব্যবহৃত।
- DTO: class-validator; role-এর মতো মান service-এ যাচাই (INVITABLE_ROLES — ADMIN, MARKETING_MANAGER, ADVERTISER, SUPPORT_AGENT, ANALYST, VIEWER; **OWNER কখনোই নয়**, service ধ্রুবক)।

### Team পেজের গঠন (web)
- `apps/web/src/app/dashboard/team/page.tsx` (925 লাইন, client): `load()` একসাথে members/invitations/usage/feed আনে; অংশগুলো card আকারে পরপর — seat usage কার্ড, email আমন্ত্রণ + সরাসরি যোগ, "অপেক্ষমাণ আমন্ত্রণ" টেবিল (resend/revoke), activity feed, ORG1 transfer কার্ড, ORG2 leave কার্ড। `myRole` দিয়ে OWNER/ADMIN অংশ শর্তসাপেক্ষ। নতুন দুটো অংশ (Invite link, যোগদানের অনুরোধ queue) এই একই পেজে, অপেক্ষমাণ আমন্ত্রণের নিচে যোগ হবে।
- `/accept-invite/page.tsx` (96 লাইন): token sessionStorage-তে জমা (`pending_invite_token` — login পেজ এটা খায় না; ধাঁচ হলো লগইনের পর ব্যবহারকারী একই লিংক আবার খোলে), লগইন না থাকলে লগইন/রেজিস্টার বোতাম, লগইন থাকলে view → accept। `/join/[token]` পেজ হুবহু এই ধাঁচে হবে (public info ফেচ লগইন ছাড়াও চলবে — নতুন `@Public` endpoint)।

## নকশা সিদ্ধান্ত (বাস্তবায়নের আগে স্থির)

1. **লিংক সরাসরি সদস্য বানায় না** — লিংক শুধু OrgJoinRequest তৈরি করে; সদস্য হওয়ার একমাত্র পথ OWNER/ADMIN-এর approve (ORG10)। এটাই এই ব্যাচের মূল নিরাপত্তা নকশা।
2. **maxUses nullable কলাম, কিন্তু "সীমাহীন" অর্থ কোথাও নেই**: DTO না পাঠালে server default **10**; পড়ার সময় সংরক্ষিত null-ও cap হিসেবে 10-ই ধরা হয়। UI সংখ্যা সবসময় পাঠায় (1–1000)।
3. **Public তথ্য ফাঁস-মুক্ত**: `GET /invitations/link/:token` — টোকেন অজানা **অথবা** লিংক revoked/expired/cap-শেষ, সব ক্ষেত্রেই হুবহু একই 404 ("Invitation link not found or the link is invalid")। বৈধ হলেই শুধু org নাম + role ফেরত।
4. **usedCount = তৈরি হওয়া অনুরোধের সংখ্যা** (approve/reject-এ বদলায় না) — cap হলো লিংক কতগুলো অনুরোধ জন্ম দিতে পারে তার সীমা (অপব্যবহার নিয়ন্ত্রণ)। Reject হওয়া ব্যবহারকারী আবার অনুরোধ করতে পারে (নতুন PENDING), তবে প্রতিবারই নতুন use খরচ হয়।
5. **একটাই PENDING**: একই user+org-তে একটার বেশি PENDING অনুরোধ নয় — service-স্তরে যাচাই (MemberInvitation-এর pending-check ধাঁচ; Prisma-তে partial unique নেই) + transaction-এর ভেতরে আবার যাচাই।
6. **Approve-এর role**: queue-তে বেছে দেওয়া role; না দিলে লিংকের role (লিংক ছাড়া তৈরি অনুরোধে VIEWER)। OWNER কোনো পথেই নয় — INVITABLE_ROLES যাচাই দুই জায়গাতেই।
7. **নিজের অনুরোধের status**: `GET /invitations/link/:token/my-request` (JWT আবশ্যক) — শুধু নিজের সর্বশেষ অনুরোধ; লিংক row পাওয়া গেলেই (revoked/expired হলেও) status দেখা যায়, যাতে লিংক প্রত্যাহারের পরেও আবেদনকারী নিজের অবস্থা জানতে পারে।

## অপব্যবহার নিয়ন্ত্রণ (তালিকা — acceptance-এর প্রতিশ্রুতি)

- Token শুধু SHA-256 hash আকারে সংরক্ষিত; raw টোকেন তৈরির মুহূর্তে একবারই ফেরত।
- লিংক: role-bound (OWNER অসম্ভব), maxUses cap (transaction-এ যাচাই), মেয়াদ (default 7 দিন), যেকোনো সময় revoke।
- অনুরোধ: প্রমাণীকৃত (JWT) অ্যাকাউন্ট লাগে, ইতিমধ্যে সদস্য হলে অসম্ভব, একটাই PENDING, message দৈর্ঘ্য-সীমিত।
- সদস্য হওয়া: শুধু OWNER/ADMIN approve-এ, সেই মুহূর্তে seatGuard; audit প্রতিটি ধাপে (link created/revoked, requested, approved, rejected)।
- আলাদা rate-limiter বানানো হয়নি (platform-এ নেই — NOT BUILT-এ দ্রষ্টব্য)।

## কমিট তালিকা (base `be70184e`-এর ওপরে)

| Commit | বিষয় |
|---|---|
| `3e281b21` | Acceptance skeleton + inventory + নকশা সিদ্ধান্ত |
| `0548b16e` | Schema: `OrgInviteLink` + `OrgJoinRequest` মডেল + হাতে-লেখা migration `20261022000000_org_invite_link` ও `20261023000000_org_join_request` |
| `71a88db4` | API: DTO + service + controller (নিচে বিস্তারিত) |
| `8a1ad6aa` | Spec `org-ob3-join.spec.ts` — 19/19 |
| `29e6ab81` | Web: Team পেজে Invite Link অংশ + যোগদানের অনুরোধ queue + public `/join/[token]` পেজ |
| (এই নথি) | OB3 acceptance |

## যা বানানো হলো — আইটেম ধরে

### ORG9 — Shareable invite link
- **মডেল `OrgInviteLink`**: id, organizationId, role (Role enum), tokenHash @unique, maxUses (nullable), usedCount, expiresAt, revokedAt?, createdById, createdAt — MemberInvitation-এর ধাঁচে relation-ছাড়া scalar।
- **Endpoints** (`@PermissionArea("team")` + TenantGuard + RolesGuard + `@Roles("OWNER","ADMIN")`; service-স্তরে `assertOrgAdmin` দ্বিতীয় যাচাই):
  - `POST /organizations/:id/invite-links` — role INVITABLE_ROLES যাচাই (OWNER/SUPER_ADMIN প্রত্যাখ্যান, spec-প্রমাণিত); maxUses default 10 (1–1000), মেয়াদ default 7 দিন (1–90); raw টোকেন `randomBytes(24)` base64url, সংরক্ষণে শুধু SHA-256 hash; ফেরতে `{ link (hash ছাড়া view), inviteUrl }` — raw লিংক **একবারই**। Audit `org.invite_link_created`।
  - `GET /organizations/:id/invite-links` — তালিকা (সর্বশেষ 100), প্রতিটিতে derived status: active / revoked / expired / exhausted; সংরক্ষিত `maxUses: null` হলেও view-তে cap **10** হিসেবেই দেখায় (কখনো "unlimited" নয় — spec-এ legacy-ধাঁচের হাতে-বসানো row দিয়ে প্রমাণিত)।
  - `DELETE /organizations/:id/invite-links/:linkId` — revokedAt বসে; দ্বিতীয়বার revoke BadRequest; audit `org.invite_link_revoked`।
- **Public তথ্য**: `GET /invitations/link/:token` (`@Public()` — JwtAuthGuard-এর IS_PUBLIC পথ, inventory-তে যাচাই করা)। বৈধ লিংকে শুধু `{ organizationName, role, valid: true }`; অজানা/revoked/expired/exhausted — **চারটেতেই হুবহু একই NotFoundException ও একই বার্তা** (spec-এ class + message সমতা assert করা)।

### ORG10 — Join-request queue
- **মডেল `OrgJoinRequest`**: id, organizationId, userId, inviteLinkId?, message? (≤500), status PENDING/APPROVED/REJECTED, decidedById?, decidedAt?, rejectReason?, createdAt/updatedAt; index (organizationId, status) ও (userId, organizationId)।
- **অনুরোধ তৈরি**: `POST /invitations/link/:token/request` (JWT আবশ্যক, TenantGuard ছাড়া — accept flow-এর ধাঁচ)। একটাই transaction-এ: সদস্য হলে Conflict → PENDING আগে থাকলে Conflict → লিংক টাটকা করে আবার state যাচাই (capসহ) → request create + usedCount +1। লিংক সক্রিয় না হলে BadRequest, টোকেন অজানা হলে একই uniform 404। Audit `org.join_requested`। **এই ধাপে কোনো membership তৈরি হয় না** (spec-এ membership সংখ্যা অপরিবর্তিত assert করা)।
- **নিজের অবস্থা**: `GET /invitations/link/:token/my-request` (JWT) — শুধু নিজের সর্বশেষ অনুরোধ (অন্যেরটা কখনো নয়, spec-প্রমাণিত); লিংক revoked/expired হলেও নিজের অনুরোধের status (ও REJECTED হলে কারণ) দেখা যায়।
- **Queue endpoints** (OWNER/ADMIN, একই guard ধাঁচ):
  - `GET /organizations/:id/join-requests` — আবেদনকারীর name/email + লিংকের role ব্যাচ-read-এ জোড়া (listMembers-এর map ধাঁচ, per-row query নয়)।
  - `POST …/join-requests/:requestId/approve` `{ role? }` — role না দিলে লিংকের role (লিংকহীন অনুরোধে VIEWER); OWNER override প্রত্যাখ্যান; **seatGuard (বিদ্যমান private মেথড) approve-এর মুহূর্তে**; membership create + request APPROVED এক transaction-এ; ইতিমধ্যে ACTIVE সদস্য হয়ে গেলে alreadyMember clean close-out (accept-এর ধাঁচে, দ্বিতীয় membership নয় — membership-এর compound unique-ও রক্ষা করে)। Audit `org.join_request_approved`।
  - `POST …/join-requests/:requestId/reject` `{ reason? }` — REJECTED + সিদ্ধান্তের তথ্য; audit `org.join_request_rejected` (কারণ নিজে metadata-তে নয়, শুধু hasReason)।
  - সিদ্ধান্ত হয়ে যাওয়া অনুরোধে আবার approve/reject → BadRequest; অজানা id → 404 (spec)।
- **Web**:
  - Team পেজে **"🔗 Invite Link (শেয়ার করা যায়)"** কার্ড (OWNER/ADMIN): role (default VIEWER — shareable বলে নিরাপদ ডিফল্ট), সর্বোচ্চ অনুরোধ-সংখ্যা (default 10), মেয়াদ (১/৭/৩০/৯০ দিন, default ৭); তৈরি হলে raw লিংক একবারের বাক্সে + **কপি বোতাম**; নিচে লিংকের তালিকা (ব্যবহার x/y, অবস্থা বাংলায়, মেয়াদ, revoke বোতাম — confirmসহ)।
  - Team পেজে **"📥 যোগদানের অনুরোধ"** কার্ড: নাম/ইমেইল/তারিখ/বার্তা/অবস্থা; PENDING সারিতে role select (ডিফল্ট লিংকের role) + অনুমোদন ও ফিরিয়ে-দিন বোতাম (reject-এ prompt-এ ঐচ্ছিক কারণ — বাতিল করলে কিছু হয় না)।
  - Public **`/join/[token]`** পেজ (build manifest-এ ƒ route): লিংক বৈধ না হলে একটাই সম্মিলিত বার্তা; লগইন না থাকলে org নাম+role দেখিয়ে লগইন/রেজিস্টার বোতাম (token sessionStorage-তে — accept-invite ধাঁচ; লগইনের পর একই লিংক আবার খুললেই চলে); লগইন থাকলে ঐচ্ছিক বার্তাসহ অনুরোধ পাঠানো; নিজের অবস্থা অনুযায়ী PENDING (অপেক্ষমাণ) / APPROVED (ড্যাশবোর্ড লিংকসহ) / REJECTED (কারণসহ; লিংক সক্রিয় থাকলে আবার অনুরোধের সুযোগ)।
  - Activity feed-এ নতুন পাঁচটা audit action-এর বাংলা লেবেল যোগ হয়েছে।

### উত্তরাধিকার-সূত্রে পাওয়া আচরণ (নতুন করে বানানো নয়)
- Archived org-এ invite-link ও join-request endpoint TenantGuard-এ আটকাবে — OB1-এর `isArchivedOwnerPath` allowlist-এ এগুলো নেই, অর্থাৎ restore-এর আগে এই পৃষ্ঠগুলো বন্ধ (lifecycle নীতির সাথে সামঞ্জস্যপূর্ণ সিদ্ধান্ত; queue-তে থাকা অনুরোধ archive-এ মোছে না)।

## গেট (সব serially চালানো)

| গেট | ফল |
|---|---|
| নতুন spec `org-ob3-join.spec.ts` | **19/19 pass** |
| API সংশ্লিষ্ট suites (`jest src/organizations`) | **15 suites, 146/146 pass** (OB2-র 14 suites/127 থেকে +1 suite, +19 test — হুবহু এই ব্যাচের spec) |
| Fresh scratch PG-তে পুরো migration sequence | **220/220 প্রয়োগ, unfinished 0** — ফোল্ডার গণনা 220 (আগের 218 + নতুন 2); `OrgInviteLink` ও `OrgJoinRequest` টেবিল `\d`-সমতুল psql যাচাইয়ে কলাম/index হুবহু; scratch cluster গেট শেষে stop + মুছে ফেলা হয়েছে |
| API `tsc --noEmit` + `npm run build` | পরিষ্কার / সবুজ |
| Web vitest | **110 files, 911/911 pass** (OB2-র সংখ্যাই — এই ব্যাচে web unit test যোগ হয়নি) |
| Web `tsc --noEmit` | পরিষ্কার (tsconfig.tsbuildinfo-র পার্শ্ব-বদল আগের অবস্থায় ফেরত দেওয়া হয়েছে) |
| Web `next build` | সবুজ — route manifest-এ `ƒ /join/[token]` ও `/dashboard/team` উপস্থিত |
| `prisma validate` | schema valid (DATABASE_URL দিয়ে চালানো — env ছাড়া CLI থামে, schema-র সমস্যা নয়) |

## NOT BUILT

- **লিংক দিয়ে সরাসরি ACTIVE সদস্য হওয়া** — নকশাগতভাবে নেই এবং হবেও না এই ব্যাচে: লিংক শুধু অনুরোধ বানায়, approve ছাড়া সদস্যপদ অসম্ভব (ORG10-এর মূল নিয়ম)।
- **Queue-এর জন্য ইমেইল জানানো** — নতুন অনুরোধ এলে OWNER/ADMIN-কে ইমেইল পাঠানো হয় **না** (M34-এর invitation email শুধু email-bound আমন্ত্রণের জন্য)। Queue Team পেজেই দেখতে হয়; activity feed-এ `org.join_requested` ধরা পড়ে। চাইলে পরে lifecycle-email ধাঁচে যোগ করা যাবে।
- **আলাদা rate-limiter** — platform-এ কোনো rate-limiter নেই, এই ব্যাচেও বানানো হয়নি। অপব্যবহার নিয়ন্ত্রণ পুরোপুরি কাঠামোগত: hash-only টোকেন, cap (transaction-যাচাই), মেয়াদ, revoke, JWT-বদ্ধ অনুরোধ, একটাই PENDING, queue ছাড়া সদস্য নয়।
- **Pending join request seat ধরে রাখে না** — সচেতন সিদ্ধান্ত (inventory দ্রষ্টব্য): seat যাচাই শুধু approve-এর মুহূর্তে; ফলে queue-তে অনেক অনুরোধ জমলেও সীমার বেশি সদস্য তৈরি অসম্ভব, তবে কোন অনুরোধ আগে seat পাবে তা approve-এর ক্রমেই ঠিক হয়।
- **Invite link-এর raw URL পুনরুদ্ধার** — তৈরি হয়ে গেলে আর কোনোভাবেই দেখা যায় না (hash-only সংরক্ষণের পরিণতি, M34-এর একই নিয়ম); হারালে নতুন লিংক বানিয়ে পুরনোটা revoke করাই পথ — Team পেজের কপি-সতর্কতায় বলা আছে।
- **লাইভ প্রমাণ** — এই ব্যাচের কিছুই লাইভ সার্ভারে প্রমাণিত নয়; sandbox/unit/fresh-PG যাচাই পর্যন্তই। Push হয়নি (local commits only)।
