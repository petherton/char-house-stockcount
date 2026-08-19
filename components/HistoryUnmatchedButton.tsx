"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildUnmatchedCsv, downloadCsv } from "@/lib/csv";

export default function HistoryUnmatchedButton({
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
      .from("stock_session_unmatched")
      .select("value, scanned_by, scanned_at")
      .eq("session_id", sessionId)
      .order("scanned_at", { ascending: true });

    const csv = buildUnmatchedCsv(
      (rows ?? []).map((r: any) => ({
        value: r.value,
        scanned_by: r.scanned_by,
        scanned_at: new Date(r.scanned_at).toLocaleString(),
      }))
    );
    downloadCsv(`${venueId}-unmatched-${sessionId.slice(0, 8)}.csv`, csv);
    setBusy(false);
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 disabled:opacity-40"
    >
      {busy ? "…" : "Unmatched CSV"}
    </button>
  );
}
