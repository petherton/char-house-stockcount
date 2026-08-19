"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildStockCountCsv, buildUnmatchedCsv, downloadCsv } from "@/lib/csv";

type Product = {
  id: string;
  lightspeed_product_id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
};

type ItemRow = {
  rowId: string; // stock_session_items.id
  product: Product;
  quantity: string; // kept as string for free typing, parsed on save/export
};

type UnmatchedRow = {
  rowId: string; // stock_session_unmatched.id
  value: string;
  at: string;
};

type Venue = { id: string; name: string };

export default function ScanApp({
  venueId,
  venueName,
  userEmail,
  venues,
}: {
  venueId: string;
  venueName: string;
  userEmail: string;
  venues: Venue[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [barcode, setBarcode] = useState("");
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [flash, setFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Load (or create) the open session for this venue, plus its items and any
  // barcodes scanned during it that didn't match the catalogue.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      const { data: openSession } = await supabase
        .from("stock_sessions")
        .select("id, created_at")
        .eq("venue_id", venueId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let sid = openSession?.id as string | undefined;
      let startedAt = openSession?.created_at as string | undefined;

      if (!sid) {
        const { data: created, error } = await supabase
          .from("stock_sessions")
          .insert({ venue_id: venueId, created_by: userEmail, status: "open" })
          .select("id, created_at")
          .single();
        if (error) {
          setFlash({ type: "err", text: `Could not start a session: ${error.message}` });
          setLoading(false);
          return;
        }
        sid = created.id;
        startedAt = created.created_at;
      }

      const [{ data: rows }, { data: unmatchedRows }] = await Promise.all([
        supabase
          .from("stock_session_items")
          .select("id, quantity, product:products(id, lightspeed_product_id, sku, barcode, name)")
          .eq("session_id", sid)
          .order("updated_at", { ascending: false }),
        supabase
          .from("stock_session_unmatched")
          .select("id, value, scanned_at")
          .eq("session_id", sid)
          .order("scanned_at", { ascending: false }),
      ]);

      if (!cancelled) {
        setSessionId(sid!);
        setSessionStartedAt(startedAt ?? null);
        setItems(
          (rows ?? []).map((r: any) => ({
            rowId: r.id,
            product: r.product,
            quantity: r.quantity === null ? "" : String(r.quantity),
          }))
        );
        setUnmatched(
          (unmatchedRows ?? []).map((u: any) => ({
            rowId: u.id,
            value: u.value,
            at: new Date(u.scanned_at).toLocaleTimeString(),
          }))
        );
        setLoading(false);
        focusInput();
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [venueId, userEmail, supabase, focusInput]);

  async function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = barcode.trim();
    setBarcode("");
    if (!value || !sessionId) {
      focusInput();
      return;
    }

    // Already in this session's list? Just jump to its quantity field.
    const existing = items.find(
      (it) => it.product.barcode === value || it.product.sku === value
    );
    if (existing) {
      setFlash({ type: "ok", text: `${existing.product.name} — already on the list, edit its quantity below.` });
      document.getElementById(`qty-${existing.rowId}`)?.focus();
      const el = document.getElementById(`row-${existing.rowId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("id, lightspeed_product_id, sku, barcode, name")
      .eq("venue_id", venueId)
      .or(`barcode.eq.${value},sku.eq.${value}`)
      .limit(1)
      .maybeSingle();

    if (error || !product) {
      const { data: newUnmatched, error: unmatchedErr } = await supabase
        .from("stock_session_unmatched")
        .insert({ session_id: sessionId, value, scanned_by: userEmail })
        .select("id, value, scanned_at")
        .single();

      if (!unmatchedErr && newUnmatched) {
        setUnmatched((prev) => [
          {
            rowId: newUnmatched.id,
            value: newUnmatched.value,
            at: new Date(newUnmatched.scanned_at).toLocaleTimeString(),
          },
          ...prev,
        ]);
      }
      setFlash({ type: "err", text: `"${value}" isn't in the ${venueName} catalogue.` });
      focusInput();
      return;
    }

    const { data: newRow, error: insertErr } = await supabase
      .from("stock_session_items")
      .insert({
        session_id: sessionId,
        product_id: product.id,
        quantity: null,
        scanned_by: userEmail,
      })
      .select("id")
      .single();

    if (insertErr) {
      setFlash({ type: "err", text: `Could not add ${product.name}: ${insertErr.message}` });
      focusInput();
      return;
    }

    setItems((prev) => [{ rowId: newRow.id, product, quantity: "" }, ...prev]);
    setFlash({ type: "ok", text: `${product.name} added — enter the quantity.` });
    requestAnimationFrame(() => document.getElementById(`qty-${newRow.id}`)?.focus());
  }

  function updateLocalQuantity(rowId: string, value: string) {
    setItems((prev) => prev.map((it) => (it.rowId === rowId ? { ...it, quantity: value } : it)));
  }

  async function persistQuantity(rowId: string, value: string) {
    setSaving(true);
    const numeric = value === "" ? null : Number(value);
    await supabase
      .from("stock_session_items")
      .update({ quantity: numeric, updated_at: new Date().toISOString() })
      .eq("id", rowId);
    setSaving(false);
  }

  function handleQuantityKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowId: string) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Blurring persists the quantity (onBlur), then we jump straight back
      // to the scan field so the next barcode can be scanned immediately.
      persistQuantity(rowId, e.currentTarget.value);
      e.currentTarget.blur();
      focusInput();
    }
  }

  async function removeRow(rowId: string) {
    setItems((prev) => prev.filter((it) => it.rowId !== rowId));
    await supabase.from("stock_session_items").delete().eq("id", rowId);
    focusInput();
  }

  async function exportCsv() {
    if (!sessionId) return;
    const csv = buildStockCountCsv(
      items.map((it) => ({
        lightspeed_product_id: it.product.lightspeed_product_id,
        name: it.product.name,
        quantity: it.quantity,
      }))
    );
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`${venueId}-stock-count-${dateStr}.csv`, csv);
    await supabase
      .from("stock_sessions")
      .update({ status: "exported", exported_at: new Date().toISOString() })
      .eq("id", sessionId);
    setFlash({ type: "ok", text: "CSV downloaded. Upload it to Lightspeed under Inventory → Stock counts." });
  }

  function exportUnmatchedCsv() {
    if (unmatched.length === 0) return;
    const csv = buildUnmatchedCsv(
      unmatched.map((u) => ({
        value: u.value,
        scanned_by: userEmail,
        scanned_at: u.at,
      }))
    );
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`${venueId}-unmatched-${dateStr}.csv`, csv);
  }

  async function startNewCount() {
    if (!confirm("Start a new count? Today's list will be saved to history.")) return;
    const { data: created, error } = await supabase
      .from("stock_sessions")
      .insert({ venue_id: venueId, created_by: userEmail, status: "open" })
      .select("id, created_at")
      .single();
    if (error) {
      setFlash({ type: "err", text: `Could not start a new count: ${error.message}` });
      return;
    }
    setSessionId(created.id);
    setSessionStartedAt(created.created_at);
    setItems([]);
    setUnmatched([]);
    focusInput();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const scannedCount = items.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 pb-28 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            The Char House
          </div>
          <h1 className="text-xl font-bold text-navy">Stock Count — {venueName}</h1>
        </div>
        <button onClick={signOut} className="text-xs text-gray-400 underline">
          Sign out
        </button>
      </header>

      {venues.length > 1 && (
        <div className="mb-4 flex gap-2">
          {venues.map((v) => (
            <a
              key={v.id}
              href={`/scan/${v.id}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                v.id === venueId ? "bg-brand text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              {v.name}
            </a>
          ))}
        </div>
      )}

      <form onSubmit={handleScanSubmit} className="mb-3">
        <label className="mb-1 block text-sm font-medium text-gray-600">
          Scan or type a barcode / SKU
        </label>
        <input
          ref={inputRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          autoFocus
          inputMode="text"
          placeholder="Ready to scan…"
          className="w-full rounded-xl border-2 border-brand px-4 py-4 text-lg font-medium shadow-sm outline-none"
        />
      </form>

      {flash && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            flash.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">Loading count…</div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
            <span>{scannedCount} product{scannedCount === 1 ? "" : "s"} counted</span>
            {saving && <span className="text-gray-400">Saving…</span>}
          </div>

          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li
                key={it.rowId}
                id={`row-${it.rowId}`}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-gray-800">{it.product.name}</div>
                  <div className="truncate text-xs text-gray-400">
                    SKU {it.product.sku ?? "—"} · {it.product.barcode ?? "no barcode"}
                  </div>
                </div>
                <input
                  id={`qty-${it.rowId}`}
                  type="number"
                  inputMode="decimal"
                  value={it.quantity}
                  placeholder="Qty"
                  onChange={(e) => updateLocalQuantity(it.rowId, e.target.value)}
                  onBlur={(e) => persistQuantity(it.rowId, e.target.value)}
                  onKeyDown={(e) => handleQuantityKeyDown(e, it.rowId)}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-right text-lg"
                />
                <button
                  onClick={() => removeRow(it.rowId)}
                  aria-label="Remove"
                  className="text-gray-300 hover:text-red-500"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {items.length === 0 && (
            <div className="mt-10 text-center text-sm text-gray-400">
              Nothing scanned yet — scan an item to start the count.
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-500">
                  Not in the catalogue ({unmatched.length})
                </div>
                <button
                  onClick={exportUnmatchedCsv}
                  className="text-xs font-medium text-brand underline"
                >
                  Export CSV
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {unmatched.map((u) => (
                  <li key={u.rowId} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {u.value} <span className="text-amber-400">· {u.at}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-gray-400">
                Ring these up through Snacks → Unidentified Beverage with the barcode in Order
                notes at the till, per the POS SOP, and flag to a manager. This list is saved as
                you scan, so it's visible from any device signed in to this count.
              </p>
            </div>
          )}
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3">
          <button
            onClick={startNewCount}
            className="flex-1 rounded-xl border border-gray-300 py-3 font-medium text-gray-600"
          >
            Start new count
          </button>
          <button
            onClick={exportCsv}
            disabled={items.length === 0}
            className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>
        <div className="mx-auto mt-2 max-w-2xl text-center text-xs text-gray-400">
          <a href={`/scan/${venueId}/history`} className="underline">
            Past counts
          </a>
          {sessionStartedAt && (
            <> · Count started {new Date(sessionStartedAt).toLocaleString()}</>
          )}
        </div>
      </div>
    </main>
  );
}
