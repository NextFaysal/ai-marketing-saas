"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor, fmtDateTime } from "@repo/contracts";
import { Breadcrumb, Skeleton } from "@repo/ui";
import { OrderDetailOn2, type MemberRow } from "../on2-detail";

/**
 * ED12 (EB5): order detail as a real route — /dashboard/orders/[id].
 * Presentation-only: the data comes from the same GET endpoints the
 * list page already uses (order detail + org members), and the body
 * is the existing OrderDetailOn2 surface. The list page's inline
 * actOrder panel stays as the quick-action surface; this route is
 * the deep-linkable full page.
 * Route-param convention follows the sibling dynamic route
 * (dashboard/commerce/reports/[type]): useParams() from
 * next/navigation.
 */
interface OrderDetail {
  id: string; externalNumber?: string | null; status: string;
  totalMinor: string; placedAt?: string | null; createdAt?: string | null;
  isCod?: boolean; paymentMethod?: string | null;
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null;
  assigneeId?: string | null; tags?: string[] | null;
}

/** Same money formatting on2-detail uses (formatMinor over the
 * minor-unit string; a bad value passes through raw). */
const money = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return String(minor); }
};

export default function OrderDetailPage() {
  const { dict, t, locale } = useLocale();
  const params = useParams();
  const router = useRouter();
  const orderId = typeof params?.id === "string" ? params.id : "";
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId || !orderId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      // Same fetches the list page performs: openOrderById's detail
      // GET (orders/page.tsx) and the members GET for assignees.
      const [detail, memberRows] = await Promise.all([
        apiFetch<OrderDetail>(`/organizations/${orgId}/orders/${orderId}`),
        apiFetch<MemberRow[]>(`/organizations/${orgId}/members`).catch(() => [] as MemberRow[]),
      ]);
      setOrder(detail);
      setMembers(memberRows ?? []);
    } catch (e) {
      setOrder(null);
      setError(e instanceof Error ? e.message : dict.orders.orderLoadFailed);
    } finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { void load(); }, [load]);

  const orderLabel = order
    ? `#${order.externalNumber ?? order.id.slice(0, 8)}`
    : `#${orderId.slice(0, 8)}`;
  const customerName = order?.customer
    ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(" ") || "—"
    : "—";
  const placedAt = order?.placedAt ?? order?.createdAt ?? null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/orders" className="text-sm font-semibold text-brand-600 hover:underline">
          {dict.orders.orderList}</Link>
        <Breadcrumb
          className="mt-2"
          items={[
            { label: dict.orders.dashboard, href: "/dashboard" },
            { label: dict.orders.order, href: "/dashboard/orders" },
            { label: orderLabel },
          ]}
        />
      </div>

      {loading ? (
        <div className="space-y-4" aria-label={dict.orders.loading2}>
          <span className="sr-only">{dict.common.loading}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <div className="card space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
            {dict.orders.tryAgain}</button>
        </div>
      ) : order ? (
        <>
          <div className="card space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h1 className="text-lg font-bold text-slate-900">{dict.orders.order}{orderLabel}</h1>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{order.status}</span>
              <span className="text-sm font-semibold">{money(order.totalMinor)}</span>
              {order.isCod ? <span className="text-sm font-semibold text-amber-600">COD</span> : order.paymentMethod ? <span className="text-sm text-slate-500">{order.paymentMethod}</span> : null}
            </div>
            <p className="text-sm text-slate-600">
              {customerName}
              {order.customer?.phone ? <span className="text-slate-400"> · {order.customer.phone}</span> : null}
            </p>
            <p className="text-xs text-slate-400">
              {placedAt ? t("orders.orderDate", { p0: fmtDateTime(locale, new Date(placedAt)) }) : dict.orders.orderDate2}
            </p>
          </div>

          <OrderDetailOn2
            orderId={order.id}
            orderLabel={orderLabel}
            assigneeId={order.assigneeId ?? null}
            tags={order.tags ?? null}
            members={members}
            onPatch={(patch) => {
              setOrder((prev) => (prev && prev.id === order.id ? { ...prev, ...patch } : prev));
            }}
            onOpenOrder={(id) => router.push(`/dashboard/orders/${id}`)}
          />
        </>
      ) : null}
    </div>
  );
}
