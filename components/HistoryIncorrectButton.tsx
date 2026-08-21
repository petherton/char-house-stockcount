"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildIncorrectMatchesCsv, downloadCsv } from "@/lib/csv";

export default function HistoryIncorrectButton({
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
      .from("stock_session_incorrect_matches")
      .select("scanned_value, description, image_url, flagged_by, flagged_at, product:products(name)")
      .eq("session_id", sessionId)
      .order("flagged_at", { ascending: true });

    const csv = buildIncorrectMatchesCsv(
      (rows ?? []).map((r: any) => ({
        product_name: r.product?.name ?? "",
        barcode: r.scanned_value ?? "",
        description: r.description ?? "",
        image_url: r.image_url ?? "",
        flagged_by: r.flagged_by,
        flagged_at: new Date(r.flagged_at).toLocaleString(),
      }))
    );
    downloadCsv(`${venueId}-incorrect-${sessionId.slice(0, 8)}.csv`, csv);
    setBusy(false);
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
    >
      {busy ? "…" : "Incorrect CSV"}
    </button>
  );
}
