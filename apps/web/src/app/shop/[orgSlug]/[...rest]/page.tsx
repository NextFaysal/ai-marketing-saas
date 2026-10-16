import { notFound } from "next/navigation";

/** GC: unknown shop subpaths land on the branded shop not-found surface. */
export default function ShopCatchAllPage() {
  notFound();
}
