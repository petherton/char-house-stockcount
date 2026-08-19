import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HistoryDownloadButton from "@/components/HistoryDownloadButton";
import HistoryUnmatchedButton from "@/components/HistoryUnmatchedButton";

export default async function HistoryPage({
  params,
}: {
  params: { venueId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await supabase
    .from("stock_sessions")
    .select("id, created_by, status, created_at, exported_at")
    .eq("venue_id", params.venueId)
    .order("created_at", { ascending: false })
    .limit(30);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const unmatchedCounts: Record<string, number> = {};
  if (sessionIds.length > 0) {
    const { data: unmatchedRows } = await supabase
      .from("stock_session_unmatched")
      .select("session_id")
      .in("session_id", sessionIds);
    for (const row of unmatchedRows ?? []) {
      unmatchedCounts[row.session_id] = (unmatchedCounts[row.session_id] ?? 0) + 1;
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <a href={`/scan/${params.venueId}`} className="text-sm text-brand">
        ← Back to count
      </a>
      <h1 className="mb-4 mt-2 text-xl font-bold text-navy">Past counts</h1>
      <ul className="flex flex-col gap-2">
        {(sessions ?? []).map((s) => {
          const unmatchedCount = unmatchedCounts[s.id] ?? 0;
          return (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium text-gray-800">
                  {new Date(s.created_at).toLocaleString()}
                </div>
                <div className="text-xs text-gray-400">
                  {s.created_by} ·{" "}
                  {s.status === "exported" ? `exported ${new Date(s.exported_at!).toLocaleString()}` : "open"}
                  {unmatchedCount > 0 && ` · ${unmatchedCount} unmatched`}
                </div>
              </div>
              <div className="flex gap-2">
                <HistoryDownloadButton sessionId={s.id} venueId={params.venueId} />
                {unmatchedCount > 0 && (
                  <HistoryUnmatchedButton sessionId={s.id} venueId={params.venueId} />
                )}
              </div>
            </li>
          );
        })}
        {(!sessions || sessions.length === 0) && (
          <li className="text-sm text-gray-400">No counts yet.</li>
        )}
      </ul>
    </main>
  );
}
