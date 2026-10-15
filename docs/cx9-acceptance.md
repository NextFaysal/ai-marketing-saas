# CX9 — Knowledge Base File Ingestion: Acceptance

Status: DELIVERED (local commit only, not pushed). Merchants can now
feed the Knowledge Base by uploading a file (.pdf / .docx / .txt /
.md) instead of only pasting text. The extracted text is chunked
into ordinary KnowledgeDocuments, so the existing keyword retrieval
picks it up with no changes to the compose path.

## What was built

- **Schema/migration** — `KnowledgeDocument.source String @default("paste")`
  (migration `20261012170000_cx9_knowledge_source`, hand-written
  additive SQL: one `ADD COLUMN ... DEFAULT 'paste'`). Paste-created
  docs keep reading `"paste"`; file-ingested docs store
  `file:<original filename>`. `listDocs` returns `source` additively
  (same rows, one extra field). **The migration is written, NOT
  applied — the sandbox has no Postgres.** It applies with the rest
  of the pending migrations at deploy time (owner's Dokploy
  redeploy + migrate step).
- **Upload endpoint** — `POST organizations/:organizationId/knowledge-documents/upload`,
  WRITE_ROLES (OWNER/ADMIN/MARKETING_MANAGER), multipart field
  `file`, Nest `FileInterceptor` with a hard 10MB multer limit.
- **Extraction service** — `apps/api/src/knowledge/extract.ts`, pure
  and unit-testable (buffers in, text out, honest Bengali
  `BadRequestException` on every failure, nothing saved).
- **Ingest** — `KnowledgeService.uploadDocFile`: extract + validate
  + chunk FULLY before creating any row (all-or-nothing). One
  KnowledgeDocument per chunk, `kind: "note"` (file content is
  reference material, not a single Q/A pair — `"faq"` would have
  mislabelled it), title = filename without extension, suffixed
  ` (অংশ N)` when chunked, `source = file:<filename>`. Exactly ONE
  audit entry per upload (`knowledge.upload`, metadata: filename,
  chunks, chars) rather than N `knowledge.create` entries — the
  upload is one merchant action. Returns
  `{ documentsCreated, charsExtracted, title }`.
- **Web** — knowledge page gains an upload form next to the paste
  form (file input accepting .pdf/.txt/.md/.docx, busy state, the
  server's Bengali error surfaced verbatim) and a source badge per
  doc (📄 filename for file docs, ✍️ হাতে লেখা for paste). The paste
  flow is untouched.

## Chunking rationale

Retrieval (`inbox/business-brain.ts` `matchKnowledge`) scores WHOLE
documents by keyword overlap — there is no chunk table and no
embedding store. Chunking therefore happens at ingest: extracted
text is split into chunks of ≤ 8,000 chars at paragraph boundaries
first; a single giant paragraph falls back to sentence boundaries
(Bengali । or Latin `.`/`!`/`?`), then spaces, then a hard cut.
8,000 stays under the 10,000-char paste cap's spirit while keeping
each doc focused enough that a keyword hit means the chunk is
actually about the query. One file = N sibling docs sharing the
`file:` source, so provenance survives chunking.

## Dependency choices

- **pdf-parse 1.1.1** (pinned) — v2.4.5 was installed and evaluated
  first and REJECTED: its bundled pdfjs-dist 5 loads its worker via
  dynamic `import()`, which throws under this repo's ts-jest CJS
  runner ("A dynamic import callback was invoked without
  --experimental-vm-modules") — the spec could not have proven real
  extraction without changing the repo-wide jest invocation, which
  was out of scope. v1.1.1 is pure CommonJS, works identically under
  jest and plain node, and the spec proves real extraction with it.
  Imported via `pdf-parse/lib/pdf-parse.js` on purpose: the package
  index runs debug file-reads when `module.parent` is falsy; the lib
  entry is the plain parser function.
  - **Real bug found + fixed while proving this:** the bundled
    pdf.js reads the raw underlying ArrayBuffer in places, ignoring
    `byteOffset`. Multer hands out pooled Buffers for small files
    (byteOffset ≠ 0), which shifts every internal PDF offset and
    corrupts the parse ("bad XRef entry") — this would have hit
    real small tenant PDFs in production, not just fixtures.
    `extract.ts` therefore hands the parser a standalone
    `Uint8Array` copy of the upload bytes.
- **fflate 0.8.3** (pinned) — tiny, zero-dependency unzip for .docx
  (a zip; we read `word/document.xml`, map `<w:p>` → newlines,
  `<w:t>` runs → text, decode XML entities). No full docx library
  needed for plain-text extraction.
- **multer 2.0.2 + @types/multer 2.3.0** (dev) — `@nestjs/platform-express`
  already brings multer transitively, but pnpm's strict resolution
  does not let `@repo/api` import it directly; the honest-400 size
  filter needs the real `MulterError` type, so multer is now an
  explicit dependency (same 2.0.2 the platform resolves to).
  `MulterErrorFilter` converts `LIMIT_FILE_SIZE` into the Bengali
  400 "ফাইল অনেক বড় — সর্বোচ্চ ১০MB আপলোড করা যাবে" instead of
  letting multer's interceptor error surface as a 500.

Install was `--filter @repo/api` only; the lockfile diff is purely
additive (new deps, nothing removed or rewritten elsewhere).

## Honest-error catalogue (all Bengali 400, nothing saved)

| Case | Message |
| --- | --- |
| No file in the request | কোনো ফাইল পাওয়া যায়নি |
| Unsupported / missing extension | সমর্থিত নয় এমন ফাইল টাইপ … শুধু .pdf, .docx, .txt, .md ফাইল আপলোড করা যাবে |
| Extension ≠ magic bytes (fake PDF, non-zip .docx) | ফাইলের আসল ফরম্যাট এক্সটেনশনের সঙ্গে মিলছে না |
| .txt/.md not clean UTF-8 text (binary junk, NUL/control chars) | ফাইলটি পাঠযোগ্য টেক্সট (UTF-8) নয় |
| Zip without `word/document.xml` | এটি বৈধ .docx ফাইল নয় (word/document.xml পাওয়া যায়নি) |
| Corrupt zip / corrupt PDF / unreadable docx XML | ফাইলটি খোলা যায়নি / PDF ফাইলটি পড়া যায়নি — ক্ষতিগ্রস্ত হতে পারে |
| PDF with no text layer (scanned image) | এই PDF থেকে লেখা পড়া যায়নি (স্ক্যান করা ছবি হতে পারে) |
| Empty extracted text (non-PDF) | ফাইল থেকে কোনো লেখা পাওয়া যায়নি |
| Extracted text > 200,000 chars | ফাইলের লেখা অনেক বড় (সর্বোচ্চ ২০০,০০০ অক্ষর) |
| File > 10MB (multer limit) | ফাইল অনেক বড় — সর্বোচ্চ ১০MB আপলোড করা যাবে |

MIME discipline follows the `inbox/media-sniff.ts` precedent:
extension AND magic bytes must agree — PDF must start `%PDF-`,
docx must start `PK\x03\x04` AND contain `word/document.xml`,
txt/md must decode as clean UTF-8 (fatal decoder + control-char
sweep, so a renamed binary is rejected, not stored as junk).

## Ceilings (stated plainly)

- **Retrieval is keyword-only.** Ingested chunks flow into the
  existing whole-doc keyword scorer. There are NO embeddings and
  no semantic search in this package — embeddings are explicitly
  OUT of scope, and nothing here claims otherwise.
- **No OCR.** A scanned-image PDF is rejected with the honest
  scanned-PDF message above; it is never silently stored empty.
- **Extraction is proven on spec fixtures only** — a hand-crafted
  PDF with a real text layer (real `Tj` operator, real xref) parsed
  by the real pdf-parse, a docx built in-spec with fflate from a
  hand-written `word/document.xml`. No live tenant file has been
  run through this yet; that awaits the M30-style live verification
  on the deployment.
- The migration is unapplied in the sandbox (no Postgres), like
  the other pending CX migrations.
- .doc (legacy Word), .rtf, .odt, spreadsheets and images are not
  accepted — the error says so rather than guessing at content.

## Verification

- New spec `apps/api/src/knowledge/knowledge-upload.spec.ts`:
  **23/23 pass** — txt/md verbatim (incl. Bengali), binary-junk
  rejection, unsupported extension, docx paragraphs + entity
  decoding, docx magic mismatch, zip-without-document.xml, real-PDF
  text extraction via the real parser, fake-PDF magic rejection,
  scanned-PDF exact error, 200k char ceiling, empty file, chunking
  (paragraph + giant-paragraph paths, every chunk ≤ 8000), service
  ingest (source/kind/title/audit shape, suffixed chunk titles,
  zero docs on failure), the REAL `matchKnowledge` retrieving an
  uploaded chunk, tenant isolation via the real `listDocs`, and the
  10MB constant + multer-filter 400.
- Knowledge + inbox targeted suites: **301/301 runnable tests
  pass**. Four inbox suites (phase-f, nextgen-p2, nextgen-p3,
  m66-visitor-stream) fail to RUN on the pre-existing parallel-track
  AG1 TS2304 in the uncommitted `webchat.service.ts`
  (`parseCourierCard`) — by path only, untouched by this package;
  the known cx3-debounce flake also appeared in the summary.
- API `tsc --noEmit` and `tsc -p tsconfig.build.json`: zero errors
  in knowledge/** (the only error anywhere is the same pre-existing
  AG1 webchat TS2304).
- Web: knowledge page type-clean (web tsc errors are only the
  parallel track's deleted-lib automations page), vitest 96/96.
