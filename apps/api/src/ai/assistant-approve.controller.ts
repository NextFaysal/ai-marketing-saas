import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { ProposalsService } from "./proposals.service";
import { approvalLinkSecret, verifyApprovalToken } from "./approval-links";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;background:#f6f7fb;margin:0;padding:24px}.card{max-width:560px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(15,23,42,.08)}h1{font-size:19px;margin:0 0 8px}p{color:#475569;line-height:1.65;white-space:pre-wrap}.row{display:flex;gap:10px;margin-top:18px}button{flex:1;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}.ok{background:#4f46e5;color:#fff}.no{background:#e2e8f0;color:#0f172a}.warn{background:#fef3c7;border-radius:12px;padding:12px;color:#92400e}</style></head><body><div class="card">${inner}</div></body></html>`;
}

/**
 * AP7 public approval-link pages. The GET NEVER decides anything —
 * it only renders the proposal and a confirm form (so Telegram's
 * link-preview fetches are harmless). The POST verifies the signed
 * token and decides as the org OWNER through the ordinary
 * approve()/reject() path (atomic claim → a replayed link just
 * reports "already decided").
 */
@Controller("assistant-approve")
export class AssistantApproveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proposals: ProposalsService,
  ) {}

  private p(): any { return this.prisma as any; }

  @Get(":proposalId")
  async show(@Param("proposalId") proposalId: string, @Query("token") token: string | undefined, @Res() res: Response) {
    const secret = approvalLinkSecret();
    if (!secret) return res.status(503).type("html").send(page("অনুমোদন লিংক বন্ধ আছে", `<h1>এই সুবিধা চালু নেই</h1><p>সার্ভারে অনুমোদন-লিংকের secret সেট করা হয়নি — dashboard থেকে অনুমোদন দিন।</p>`));
    if (!verifyApprovalToken(secret, proposalId, token)) {
      return res.status(403).type("html").send(page("অবৈধ লিংক", `<h1>লিংকটি অবৈধ বা মেয়াদ শেষ</h1><p>নতুন লিংক তৈরি করতে dashboard-এর প্রস্তাব কার্ড ব্যবহার করুন।</p>`));
    }
    const row = await this.p().aIActionProposal.findFirst({ where: { id: proposalId } });
    if (!row) return res.status(404).type("html").send(page("পাওয়া যায়নি", `<h1>প্রস্তাবটি পাওয়া যায়নি</h1>`));
    if (row.status !== "proposed") {
      return res.type("html").send(page("সিদ্ধান্ত হয়ে গেছে", `<h1>“${esc(row.title)}”</h1><p>এই প্রস্তাবের সিদ্ধান্ত আগেই হয়েছে — বর্তমান status: <b>${esc(row.status)}</b>${row.error ? `\nত্রুটি: ${esc(String(row.error))}` : ""}</p>`));
    }
    const inner = `<h1>${esc(row.title)}</h1><p>${esc(row.preview)}</p>
      <p class="warn">⚠ অনুমোদন দিলে কাজটি সত্যিই কার্যকর হবে। সিদ্ধান্তটি org-এর OWNER হিসেবে রেকর্ড হবে।</p>
      <form method="POST" action="">
        <input type="hidden" name="token" value="${esc(token ?? "")}">
        <div class="row">
          <button class="ok" type="submit" name="decision" value="approve">✓ অনুমোদন দিন</button>
          <button class="no" type="submit" name="decision" value="reject">✕ প্রত্যাখ্যান</button>
        </div>
      </form>`;
    return res.type("html").send(page(row.title, inner));
  }

  @Post(":proposalId")
  async decide(
    @Param("proposalId") proposalId: string,
    @Body() body: { token?: string; decision?: string },
    @Res() res: Response,
  ) {
    const secret = approvalLinkSecret();
    if (!secret) return res.status(503).type("html").send(page("বন্ধ আছে", `<h1>এই সুবিধা চালু নেই</h1>`));
    if (!verifyApprovalToken(secret, proposalId, body?.token)) {
      return res.status(403).type("html").send(page("অবৈধ লিংক", `<h1>লিংকটি অবৈধ বা মেয়াদ শেষ</h1>`));
    }
    const row = await this.p().aIActionProposal.findFirst({ where: { id: proposalId } });
    if (!row) return res.status(404).type("html").send(page("পাওয়া যায়নি", `<h1>প্রস্তাবটি পাওয়া যায়নি</h1>`));
    const owner = await this.p().membership.findFirst({
      where: { organizationId: row.organizationId, role: "OWNER", status: "ACTIVE" },
    });
    if (!owner) return res.status(400).type("html").send(page("OWNER নেই", `<h1>এই org-এ সক্রিয় OWNER পাওয়া যায়নি — dashboard থেকে সিদ্ধান্ত দিন।</h1>`));
    try {
      const updated: any = body?.decision === "reject"
        ? await this.proposals.reject(row.organizationId, owner.userId, proposalId)
        : await this.proposals.approve(row.organizationId, owner.userId, proposalId);
      const note = updated.status === "executed"
        ? "প্রস্তাবটি অনুমোদিত ও কার্যকর হয়েছে।"
        : updated.status === "failed"
          ? `প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হয়েছে: ${esc(String(updated.error ?? "platform error"))}`
          : "প্রস্তাবটি প্রত্যাখ্যান করা হয়েছে।";
      return res.type("html").send(page("সিদ্ধান্ত রেকর্ড হয়েছে", `<h1>“${esc(row.title)}”</h1><p>${note}</p>`));
    } catch (e) {
      const message = e instanceof Error ? e.message : "সিদ্ধান্ত ব্যর্থ হয়েছে";
      return res.type("html").send(page("সিদ্ধান্ত হয়নি", `<h1>“${esc(row.title)}”</h1><p>${esc(message)}</p>`));
    }
  }
}
