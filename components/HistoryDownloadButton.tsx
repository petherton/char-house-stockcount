"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildStockCountCsv, downloadCsv } from "@/lib/csv";

export default function HistoryDownloadButton({
  sessionId,
  venueId,
}: {
  sessionId: string;
  venueId: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    const supabase = createClient();
    const { data: rows } = await supabase
      .from("stock_session_items")
      .select("quantity, product:products(lightspeed_product_id, name)")
      .eq("session_id", sessionId);

    const csv = buildStockCountCsv(
      (rows ?? []).map((r: any) => ({
        lightspeed_product_id: r.product.lightspeed_product_id,
        name: r.product.name,
        quantity: r.quantity,
      }))
    );
    downloadCsv(`${venueId}-stock-count-${sessionId.slice(0, 8)}.csv`, csv);
    setBusy(false);
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-40"
    >
      {busy ? "…" : "Download CSV"}
    </button>
  );
}
