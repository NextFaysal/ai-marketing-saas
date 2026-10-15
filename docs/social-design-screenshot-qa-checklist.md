# Social Posts Design v2 — Screenshot QA Checklist (deploy-পরবর্তী)

**কখন করতে হবে:** Social Posts Design প্যাকেজ (SD1–SD8) deploy হওয়ার
পর — অর্থাৎ SU প্যাকেজের সঙ্গে integration + push + Dokploy
Redeploy সম্পন্ন হলে, live অ্যাপে (বা staging build-এ)।
**কেন আলাদা doc:** sandbox-এ live app নেই, তাই SD প্যাকেজের কোনো
batch-ই screenshot QA করতে পারেনি — visual ফলাফল code, build ও
zero-loss গণনা দিয়ে যাচাই হয়েছে, চোখে দেখে নয়। এই checklist সেই
বকেয়া যাচাইটা deploy-এর পরের ধাপ হিসেবে ধরে রাখে।
**সব box UNCHECKED** — deploy-এর পর প্রতিটি item দেখে তবেই tick
দিতে হবে; যা দেখা হয়নি তা tick নয়।

প্রতিটি viewport-এ যাচাই: **Desktop 1440px · Tablet 768px ·
Mobile 390px** — এবং প্রতিটি tab: **Composer · Posts ও Calendar ·
Library · Analytics · Settings ও Accounts**।

---

## A. সাধারণ (সব viewport, সব tab)

- [ ] Power header: stat chip-গুলোর সংখ্যা পেজের আসল data-র সঙ্গে মেলে (সংযুক্ত অ্যাকাউন্ট / Queue / অনুমোদনের অপেক্ষায়); Failed ও ⚠️ health chip শুধু সংখ্যা > ০ হলেই দেখা যায়
- [ ] Header chip-এ click করলে সঠিক tab-এ যায়
- [ ] Sticky tab rail scroll করলেও উপরে আটকে থাকে, topbar-এর নিচে ঠিকমতো বসে (overlap/gap নেই)
- [ ] Active tab-এ brand gradient দেখা যায়; tenant-এর নিজের brand রং বদলালে (white-label) header/rail/chip-এর রংও বদলায়
- [ ] URL hash deep-link কাজ করে: `#posts` দিয়ে সরাসরি খুললে Posts tab আসে; tab বদলালে hash বদলায়; reload-এ tab টিকে থাকে
- [ ] Error/notice banner dismiss button কাজ করে, লেখা আগের মতোই
- [ ] Keyboard দিয়ে Tab চাপলে প্রতিটি button/link/input-এ focus ring দেখা যায়
- [ ] কোনো horizontal scroll নেই (calendar ও analytics table ছাড়া — সেগুলো নিজের wrapper-এর ভিতরে scroll হয়)
- [ ] Status/approval/health pill সব জায়গায় একই আকার ও রঙে দেখা যায়

## B. Composer tab

- [ ] Desktop: ৪ ধাপের কার্ড (১ Content / ২ Media / ৩ Accounts / ৪ Save) এক কলামে, preview rail ডানে sticky — scroll করলে preview চোখের সামনে থাকে
- [ ] Mobile (390px): ধাপগুলো একটার নিচে একটা; preview steps-এর নিচে inline আসে, rail sticky হয় না
- [ ] Mobile: নিচের sticky action bar-এ শুধু Save button, bottom nav-এর ঠিক উপরে বসে, content ঢেকে ফেলে না; Desktop-এ bar দেখা যায় না
- [ ] Pre-flight checklist: নিয়ম ভাঙলে লাল ✗ লাইন (আগের warning লেখাই), সব ঠিক থাকলে সবুজ ✓ "প্রকাশের জন্য প্রস্তুত"
- [ ] Media dropzone-এ ফাইল drag করলে brand ring highlight হয়; drop করলে upload শুরু হয়; composer-এ paste করলেও ছবি upload হয়
- [ ] Step badge (১–৪) brand gradient বৃত্তে দেখা যায়
- [ ] AI button-গুলো (.btn-ai) এক ছাঁচে gradient
- [ ] Library picker খুললে composer-এর লেখা/state হারায় না

## C. Posts ও Calendar tab

- [ ] Post card: বামে thumbnail, account avatar + platform dot, status pill ডানদিকে; শিডিউল/প্রকাশের সময় বড় ও স্পষ্ট
- [ ] Bulk বাছাই করা card-এ brand ring দেখা যায়
- [ ] Detail expander খুললে নোট/Version/Timeline — খালি থাকলে compact dashed empty surface, লেখা আগের মতোই
- [ ] Calendar (desktop/tablet): আজকের cell-এ brand highlight; post chip-এ platform dot + সময়
- [ ] Calendar (mobile 390px): 7-column grid-এর বদলে দিন ধরে agenda list; আজকের দিনে "আজ" badge; খালি মাসে designed empty state
- [ ] Queue view: timeline-এর বাম রেলে brand dot, সময় বড় অক্ষরে
- [ ] Approval queue: amber header band; খালি থাকলে designed empty state
- [ ] "আরও দেখুন" চাপলে skeleton block দেখা যায়, তারপর নতুন post আসে
- [ ] Posting slot সারিতে avatar + platform chip; খালি থাকলে designed empty state

## D. Library tab

- [ ] Grid: mobile ২ / tablet ৩ / desktop ৪ / wide ৫ column — tile ভাঙে না, ছবি crop ঠিকঠাক
- [ ] Folder chip rail scroll হয়; active folder-এ brand gradient
- [ ] Video tile-এ 🎬 ভিডিও badge; hover করলে quick-action overlay আসে (Cover/PNG/Crop — tile অনুযায়ী); touch-এ নিচের বোতামগুলোই কাজ করে
- [ ] Tile-এর নাম/বোতাম এখন 12px — আগের চেয়ে পড়তে সহজ; tag chip ও ফোল্ডার লাইন ছোট meta হিসেবেই আছে
- [ ] Bulk বাছাই করা tile-এ brand ring
- [ ] খালি লাইব্রেরিতে designed empty state (🖼️ icon + আগের লেখা)
- [ ] MediaThumb লোড হওয়ার সময় shimmer placeholder দেখা যায়

## E. Analytics tab

- [ ] উপরের ৪টি stat tile: data থাকলে সংখ্যা, না থাকলে "—" (কখনো বানানো ০ নয়); subtext 12px-এ পড়া যায়
- [ ] Timeseries bar-এ brand gradient; মান ও দিনের label পাঠযোগ্য; bar-এ hover করলে title tooltip আসে
- [ ] Account/follower সারিতে avatar + platform dot
- [ ] Data না থাকা প্রতিটি অংশে designed empty state, সৎ লেখা হুবহু আগের মতো
- [ ] Report export card আলাদা block হিসেবে; মাস বেছে CSV/PDF download হয়
- [ ] Tablet/mobile-এ table নিজের wrapper-এ scroll হয়, পেজ ভাঙে না

## F. Settings ও Accounts tab

- [ ] Account card grid: mobile ১ / tablet ২ / wide ৩ column; card-এ বড় avatar + platform dot, platform chip, status pill
- [ ] Health data থাকলে card-এই health pill ও "শেষ যাচাই" সময় দেখা যায়; health section-এর row-র সঙ্গেও মেলে
- [ ] Account error থাকলে লাল alert block-এ verbatim error (কাটা/বদলানো নয়)
- [ ] Disconnect বোতাম আলাদা লাল danger zone-এ, card-এর মূল অংশ থেকে পৃথক
- [ ] অ্যাকাউন্ট না থাকলে designed empty state (🔗 icon + আগের লেখা)
- [ ] YouTube channel picker: channel সারিতে বড় avatar (ছবি না থাকলে initials); লোড হওয়ার সময় লেখা + skeleton row
- [ ] Meta token দিয়ে Page খুঁজলে আবিষ্কৃত Page-এর badge-এ platform dot; Page না পেলে compact empty state
- [ ] Toggle গুলো (অনুমোদন / দুই-ধাপ / Auto-Draft) এক ছাঁচে — brand রঙের checkbox, বড় click এলাকা
- [ ] Failure center: group card-এ লাল ring, error signature, পোস্ট সংখ্যার chip, প্রতি post-এ স্পষ্ট Retry বোতাম; ব্যর্থ post না থাকলে compact empty state (সব ঠিকঠাক লেখাসহ)

## G. Responsive চূড়ান্ত যাচাই

- [ ] 390px: কোনো text/button পর্দার বাইরে যায় না; Settings-এর select ও Posts-এর filter input ভাঙে না
- [ ] 768px: Composer grid এক কলামেই থাকে (rail নিচে), Library ৩ column, account grid ২ column
- [ ] 1440px: পেজ অতিরিক্ত ছড়িয়ে যায় না; preview rail 380px-ই থাকে
- [ ] Touch target: tab ও প্রধান বোতাম কমপক্ষে 44px উঁচু (মোবাইলে আঙুলে চাপা সহজ)
- [ ] `prefers-reduced-motion` চালু থাকলে skeleton shimmer/animation থামে বা কমে

---

**ফলাফল রেকর্ড:** QA শেষ হলে এই ফাইলের পাশে তারিখ ও কে করেছে তা
লিখে tick দেওয়া box গুলোসহ commit করতে হবে। কোনো item fail হলে
সেটি এই doc-এ note করে আলাদা fix commit — চুপচাপ tick নয়।
