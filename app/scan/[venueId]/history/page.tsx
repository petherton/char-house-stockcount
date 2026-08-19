import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HistoryDownloadButton from "@/components/HistoryDownloadButton";

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

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <a href={`/scan/${params.venueId}`} className="text-sm text-brand">
        ← Back to count
      </a>
      <h1 className="mb-4 mt-2 text-xl font-bold text-navy">Past counts</h1>
      <ul className="flex flex-col gap-2">
        {(sessions ?? []).map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
          >
            <div>
              <div className="font-medium text-gray-800">
                {new Date(s.created_at).toLocaleString()}
              </div>
              <div className="text-xs text-gray-400">
                {s.created_by} ·{" "}
                {s.status === "exported" ? `exported ${new Date(s.exported_at!).toLocaleString()}` : "open"}
              </div>
            </div>
            <HistoryDownloadButton sessionId={s.id} venueId={params.venueId} />
          </li>
        ))}
        {(!sessions || sessions.length === 0) && (
          <li className="text-sm text-gray-400">No counts yet.</li>
        )}
      </ul>
    </main>
  );
}
