import { Injectable } from "@nestjs/common";
import { promises as dns } from "node:dns";

/**
 * EC8 custom-domain helpers, isolated behind injectable classes so
 * specs can stub DNS and HTTP deterministically. The production
 * implementations do REAL lookups/fetches — a domain is only ever
 * reported verified/routed when the outside world proves it.
 */
@Injectable()
export class StorefrontDnsResolver {
  /** Returns the TXT record set for host, each record pre-joined. */
  async resolveTxt(host: string): Promise<string[]> {
    const records = await dns.resolveTxt(host);
    return records.map((parts) => parts.join(""));
  }
}

export interface RoutingFetchResult {
  status: number;
  finalUrl: string;
  body: string;
}

@Injectable()
export class StorefrontRoutingFetcher {
  async fetchText(url: string): Promise<RoutingFetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "Qosprey-Storefront-Routing-Check/1.0" },
      });
      const body = await res.text();
      return { status: res.status, finalUrl: res.url || url, body: body.slice(0, 200_000) };
    } finally {
      clearTimeout(timer);
    }
  }
}
