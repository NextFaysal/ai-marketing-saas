# Organization Next — Batch OB1 Acceptance (ORG1 + ORG2 + ORG3 + ORG4)

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-org`, branch `org-next`, base `ca868858` (OU লাইন — এই base-এ GC + TD কোডও আছে)।
সূত্র পরিকল্পনা: `Organization-Next-Plan-2026-10-16.md` গুচ্ছ A (lifecycle)।
Local commits only — **কোনো push হয়নি**। আগের coordinator daemon restart-এ গেট-পর্যায়ে মারা গিয়েছিল; finisher পুরো diff পুনঃযাচাই করে গেট চালিয়ে এই নথি লিখেছে — কোনো আইটেম নতুন করে বানানো হয়নি, অর্ধেক কিছু পাওয়া যায়নি।

## কমিট তালিকা (base-এর ওপরে ৭টা)

| Commit | বিষয় |
|---|---|
| `d6103044` | ORG3 schema — `Organization.archivedAt` (nullable timestamp) + migration `20261021000000_org_archive`; platform `status` কলাম অপরিবর্তিত |
| `c4b0ba5c` | ORG1+ORG2+ORG3 API — transfer / leave / archive / restore endpoint + service |
| `d9fb24ba` | TenantGuard archived blocking + OWNER allowlist; lifecycle spec + guard spec |
| `f59cf36b` | Switcher state badges (স্থগিত/আর্কাইভ করা) + `org-switcher` helper ও test |
| `49e0ce68` | OrgStateGate (dashboard layout) — suspended ও archived পূর্ণ-পর্দা অবস্থা |
| `0ffafe69` | Team page — ownership transfer + self-leave UI |
| `96489856` | Settings OrgLifecycleCard — archive/restore + permanent-close-এর সৎ ব্যাখ্যা |
| (এই নথি) | OB1 acceptance |

## যা বানানো হলো — আইটেম ধরে (diff পড়ে যাচাই করা)

### ORG1 — Ownership transfer
- `POST /organizations/:id/transfer-ownership` (OWNER only, `TransferOwnershipDto.targetUserId`)। সাধারণ role endpoint দিয়ে OWNER দেওয়া আগের মতোই **নিষিদ্ধ** — transfer-ই একমাত্র পথ।
- Service যাচাই: actor অবশ্যই বর্তমান OWNER ও ACTIVE; target একই org-এর **ACTIVE ADMIN** সদস্য হতে হবে (অন্য ভূমিকা হলে "আগে ADMIN করুন" বার্তাসহ প্রত্যাখ্যান; নিজেকে target করা যাবে না)।
- Role অদলবদল **একটাই `$transaction`**-এ (target → OWNER, পুরনো মালিক → ADMIN) — org কখনো মালিকহীন বা দ্বি-মালিক অবস্থায় পড়ে না।
- Audit: `org.ownership_transferred` (from/to userId + email)। দুই পক্ষকে best-effort ইমেইল — SMTP অকনফিগার্ড/ব্যর্থ হলেও transfer আটকায় না; ফেরতে `notified` পতাকা সৎভাবে জানায় পাঠানো হয়েছে কিনা।
- Web: Team page-এ দ্বি-ধাপ নিশ্চিতকরণ — প্রার্থী তালিকা শুধু ADMIN সদস্যদের, দ্বিতীয় ধাপে **org-এর নাম লিখে** নিশ্চিত করতে হয়।

### ORG2 — Self-leave
- `POST /organizations/:id/leave` — সেবাটি leave-কে ডাককারীর **নিজের** membership-এর সাথে বাঁধে (অন্যের হয়ে leave অসম্ভব)।
- OWNER leave করতে পারে না — বার্তায় transfer-এর পথ দেখানো হয় ("আগে ADMIN-এর কাছে হস্তান্তর করুন, তারপর ছাড়ুন")।
- Departure cleanup removeMember-এর সাথে **একটাই ভাগ করা পথ** (`purgeMembership`): খোলা conversation pool-এ ফেরত, inbox-team roster ও agent state মোছা, membership row মোছা; audit `org.member_left` (handedOver সংখ্যাসহ)। শেষ অ-মালিক সদস্য ছাড়লেও org মালিকহীন হয় না (OWNER সবসময় থাকে)।
- Web: Team page-এ leave বোতাম; OWNER হলে transfer-এর দিকে নির্দেশ; leave-এর পর org তালিকা থেকে সরে গিয়ে পরের org-এ switch।

### ORG3 — Tenant-side archive / restore
- `Organization.archivedAt` — tenant-স্তরের আলাদা অবস্থা; platform `status` (ACTIVE|SUSPENDED|DELETED, admin-only) **ছোঁয়া হয়নি**।
- `POST /organizations/:id/archive` ও `/restore` — শুধু OWNER; idempotent (ইতিমধ্যে archived হলে `unchanged: true` ফেরত)। Audit: `org.archived` / `org.restored`।
- TenantGuard: archived org-এ **সব সদস্যের** (OWNER-সহ) সব org-API বন্ধ, শুধু OWNER-এর allowlist খোলা — org নিজে পড়া (GET), archive/restore, transfer-ownership, leave, আর data-tools export পৃষ্ঠা (তৈরি/তালিকা/ডাউনলোড, backup preference, audit-log viewer)। Platform suspension-এর যাচাই আগের মতোই **আগে** জেতে।
- Web: OrgStateGate archived পর্দা — OWNER হলে restore বোতাম + export তালিকা/ডাউনলোড; settings-এ OrgLifecycleCard (দ্বি-ধাপ নিশ্চিতে archive, restore)।

### ORG4 — Suspended-org tenant অভিজ্ঞতা
- `listMine` এখন org-এর `status` ও `archivedAt` দুটোই বহন করে (service পুরো org row ফেরত দেয়); switcher-এ সারি ও বোতামে ব্যাজ — **স্থগিত** / **আর্কাইভ করা** (দুটো একসাথে হলে স্থগিত জেতে)।
- OrgStateGate (dashboard layout): platform-suspended org বেছে নিলে পূর্ণ-পর্দা ব্যাখ্যা — কী হয়েছে, ডেটা অক্ষত আছে, সহায়তার পথ; archived হলে আলাদা পর্দা (ওপরে)। Portfolio পেজ gate-এর বাইরে (সব org-এর rollup দেখা যায়)।

## নেওয়া ডিফল্ট সিদ্ধান্ত (মালিকের D4/D5 খোলা ছিল — উল্টানো যায়)

1. **Transfer তাৎক্ষণিক** — গন্তব্য সদস্যের consent/accept ধাপ v1-এ **নেই** (D4)। বর্তমান OWNER-এর সিদ্ধান্তেই হস্তান্তর কার্যকর হয়; সুরক্ষা হিসেবে target শুধু ACTIVE ADMIN, Team page-এ নাম-লিখে নিশ্চিতকরণ, audit + দুই পক্ষকে ইমেইল।
2. **Suspend-এর কারণের কাঁচা লেখা tenant দেখে না** (D5) — admin-এর অভ্যন্তরীণ নোট/কারণ tenant-দৃশ্যমান নয়; OrgStateGate শুধু tenant-safe সারাংশ দেখায় (org স্থগিত, ডেটা অক্ষত, সহায়তায় যোগাযোগের পথ)।

## গেট (সব serially চালানো, আসল সংখ্যা)

| গেট | ফলাফল |
|---|---|
| Fresh scratch PG-তে পুরো migration sequence | **218/218 প্রয়োগ** — এই tree-র মোট migration ফোল্ডার 218টা (base-এ 217 + নতুন `20261021000000_org_archive`); `_prisma_migrations`-এ finished 218, unfinished 0। `Organization.archivedAt` কলাম `information_schema` দিয়ে যাচাই: timestamp, nullable ✓। Scratch cluster গেট শেষে stop + মুছে ফেলা হয়েছে। (পরিবেশ-নোট: এই sandbox-এ embedded PostgreSQL 18.4 বাইনারি ব্যবহার হয়েছে; migration-গুলো plain DDL, পরিষ্কারভাবে চলেছে।) |
| API suites — organizations + admin + common (jest --runInBand) | **50 suites, 513 tests: 512 pass, 1 fail** (নিচে)। OB1-এর নিজের spec দুটো এর ভেতরেই সবুজ: `org-ob1-lifecycle.spec.ts` **15/15**, `tenant.guard.spec.ts` **12/12** |
| API `tsc --noEmit` | পরিষ্কার |
| API build (`tsc -p tsconfig.build.json`) | সবুজ — `dist`-এ `transferOwnership`/`archiveOrganization` grep-প্রমাণিত |
| Web vitest (পুরো) | **110 ফাইল, 904/904 pass** (org-switcher helper test 9টা-সহ) |
| Web `tsc --noEmit` | পরিষ্কার |
| Web `next build` | সবুজ (exit 0) |

### একমাত্র লাল — pre-existing, base-প্রমাণিত (OB1-এর কারণে নয়)
`apps/api/src/admin/adx3-nav-counts.spec.ts` — "counts every field from real rows…" টেস্টে `overdueSubscriptions` expected 1, received 2 (spec line 91)।
প্রমাণ: (১) OB1-এর diff-এ `apps/api/src/admin/`-এ পরিবর্তন **০ লাইন**; spec-টি শুধু `./admin.service` import করে, যেটি organizations থেকে শুধু `org-data-export` নেয় — সেটাও OB1-এ অপরিবর্তিত। (২) Base commit `ca868858`-এর আলাদা worktree-তে **একই spec হুবহু একই assertion-এ** fail করেছে (1 failed / 6 passed)। (৩) এই ব্যর্থতা আগের প্যাকেজের গেটেও "adx3 base-proven" হিসেবে নথিভুক্ত ছিল। OB1 দিয়ে এটি ঠিক করার চেষ্টা করা হয়নি — scope-এর বাইরে।

## NOT BUILT (স্পষ্ট)

- **Consent/accept transfer flow** — গন্তব্য সদস্যের সম্মতি ধাপ নেই (ডিফল্ট সিদ্ধান্ত ১ দ্রষ্টব্য); চাইলে OB-পরবর্তী ছোট কাজ।
- **Tenant self-serve permanent close** — বানানো হয়নি। Settings-এর OrgLifecycleCard শুধু সৎভাবে ব্যাখ্যা করে: আগে data export নিন, স্থায়ী মোছা platform team করে (admin permanent delete), আর slug 180 দিন সংরক্ষিত থাকে (TD11)। কোনো ভান-বোতাম নেই।
- **Archive-এর subscription/billing প্রভাব ছোঁয়া হয়নি** — archive subscription বাতিল/pause করে না, বিলিং চক্রে হাত দেয় না; subscription pause/resume আগের আলাদা পথেই আছে। Archived org বিল হতে থাকবে কিনা — নীতি-সিদ্ধান্ত বাকি (প্ল্যানের "নকশা-নোটে ঠিক হবে" অংশের এই অংশটা অমীমাংসিত রইল)।
- **Suspend-এর tenant-safe কারণ-সারাংশের আলাদা ফিল্ড** — বানানো হয়নি; পর্দা স্থির ব্যাখ্যা দেখায়, admin-এর লেখা থেকে তৈরি সারাংশ নয় (ডিফল্ট সিদ্ধান্ত ২-এর সীমা)।
- **লাইভ প্রমাণ: সবই বাকি** — কোনো আসল org-এ transfer/leave/archive চালিয়ে দেখা হয়নি; বাস্তব SMTP দিয়ে lifecycle ইমেইল পৌঁছানো যাচাই হয়নি (spec-এ fake দিয়ে প্রমাণিত মাত্র)। Deploy-এর পর TD12/M30 ধাঁচের লাইভ যাচাই বাকি থাকবে।
- Admin app-এ এই lifecycle-এর কোনো নতুন পর্দা বানানো হয়নি (OB1 tenant-মুখী; admin-এর suspend/delete আগের মতোই)।
