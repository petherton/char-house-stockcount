"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildStockCountCsv, buildUnmatchedCsv, downloadCsv } from "@/lib/csv";
import ProductImportButton from "@/components/ProductImportButton";

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
  newName: string;
  newPrice: string;
  notes: string;
  editOpen: boolean;
};

type UnmatchedRow = {
  rowId: string; // stock_session_unmatched.id
  value: string;
  at: string;
  description: string | null;
  imageUrl: string | null;
  productName: string | null;
  sellPrice: number | null;
  quantity: number | null;
};

type UnmatchedDraft = {
  open: boolean;
  description: string;
  file: File | null;
  saving: boolean;
  productName: string;
  sellPrice: string;
  costPrice: string;
  category: string;
  container: string;
  sizeMl: string;
  quantity: string;
};

const CONTAINERS = ["BOTTLE", "CAN", "UNIT", "BAG", "PACKET", "TUB", "KEG", "CONTAINER"];

/** Placeholder products were created in Lightspeed with the barcode as their name. */
function looksLikeBarcode(name: string) {
  return /^\d{6,14}$/.test(name.trim());
}

function toNumberOrNull(v: string): number | null {
  const t = v.trim().replace(/^\$/, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type IncorrectDraft = {
  open: boolean;
  description: string;
  file: File | null;
  saving: boolean;
  done: boolean;
};

type Venue = { id: string; name: string };

const emptyUnmatchedDraft: UnmatchedDraft = {
  open: true,
  description: "",
  file: null,
  saving: false,
  productName: "",
  sellPrice: "",
  costPrice: "",
  category: "",
  container: "BOTTLE",
  sizeMl: "",
  quantity: "",
};
const emptyIncorrectDraft: IncorrectDraft = {
  open: true,
  description: "",
  file: null,
  saving: false,
  done: false,
};

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
  const [unmatchedDrafts, setUnmatchedDrafts] = useState<Record<string, UnmatchedDraft>>({});
  const [incorrectDrafts, setIncorrectDrafts] = useState<Record<string, IncorrectDraft>>({});
  const [flash, setFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

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

      const [{ data: rows }, { data: unmatchedRows }, { data: categoryRows }] = await Promise.all([
        supabase
          .from("stock_session_items")
          .select("id, quantity, new_name, new_sell_price, notes, product:products(id, lightspeed_product_id, sku, barcode, name)")
          .eq("session_id", sid)
          .order("updated_at", { ascending: false }),
        supabase
          .from("stock_session_unmatched")
          .select("id, value, scanned_at, description, image_url, product_name, sell_price, quantity")
          .eq("session_id", sid)
          .order("scanned_at", { ascending: false }),
        supabase
          .from("products")
          .select("pos_category")
          .eq("venue_id", venueId)
          .not("pos_category", "is", null)
          .limit(5000),
      ]);

      if (!cancelled) {
        setSessionId(sid!);
        setSessionStartedAt(startedAt ?? null);
        setItems(
          (rows ?? []).map((r: any) => ({
            rowId: r.id,
            product: r.product,
            quantity: r.quantity === null ? "" : String(r.quantity),
            newName: r.new_name ?? "",
            newPrice: r.new_sell_price === null || r.new_sell_price === undefined ? "" : String(r.new_sell_price),
            notes: r.notes ?? "",
            editOpen: false,
          }))
        );
        setCategories(
          Array.from(new Set((categoryRows ?? []).map((c: any) => c.pos_category as string))).sort()
        );
        setUnmatched(
          (unmatchedRows ?? []).map((u: any) => ({
            rowId: u.id,
            value: u.value,
            at: new Date(u.scanned_at).toLocaleTimeString(),
            description: u.description ?? null,
            imageUrl: u.image_url ?? null,
            productName: u.product_name ?? null,
            sellPrice: u.sell_price ?? null,
            quantity: u.quantity ?? null,
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
      .eq("is_active", true)
      .or(`barcode.eq.${value},sku.eq.${value}`)
      .limit(1)
      .maybeSingle();

    if (error || !product) {
      const { data: newUnmatched, error: unmatchedErr } = await supabase
        .from("stock_session_unmatched")
        .insert({ session_id: sessionId, value, scanned_by: userEmail })
        .select("id, value, scanned_at, description, image_url, product_name, sell_price, quantity")
        .single();

      if (!unmatchedErr && newUnmatched) {
        setUnmatched((prev) => [
          {
            rowId: newUnmatched.id,
            value: newUnmatched.value,
            at: new Date(newUnmatched.scanned_at).toLocaleTimeString(),
            description: newUnmatched.description ?? null,
            imageUrl: newUnmatched.image_url ?? null,
            productName: null,
            sellPrice: null,
            quantity: null,
          },
          ...prev,
        ]);
        setUnmatchedDrafts((prev) => ({ ...prev, [newUnmatched.id]: { ...emptyUnmatchedDraft } }));
      }
      setFlash({ type: "err", text: `"${value}" isn't in the ${venueName} catalogue. Add it as a new product below.` });
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

    setItems((prev) => [
      {
        rowId: newRow.id,
        product,
        quantity: "",
        newName: "",
        newPrice: "",
        notes: "",
        editOpen: looksLikeBarcode(product.name),
      },
      ...prev,
    ]);
    setFlash({
      type: "ok",
      text: looksLikeBarcode(product.name)
        ? `${product.name} has no proper name in Lightspeed yet. Enter the quantity, then give it a name below.`
        : `${product.name} added. Enter the quantity.`,
    });
    requestAnimationFrame(() => document.getElementById(`qty-${newRow.id}`)?.focus());
  }

  function updateLocalQuantity(rowId: string, value: string) {
    setItems((prev) => prev.map((it) => (it.rowId === rowId ? { ...it, quantity: value } : it)));
  }

  function updateLocalItem(rowId: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.rowId === rowId ? { ...it, ...patch } : it)));
  }

  async function persistEdits(rowId: string) {
    const it = items.find((x) => x.rowId === rowId);
    if (!it) return;
    const price = toNumberOrNull(it.newPrice);
    if (it.newPrice.trim() !== "" && (price === null || price < 0)) {
      setFlash({ type: "err", text: "Price needs to be a number, e.g. 24.99" });
      return;
    }
    const name = it.newName.trim();
    setSaving(true);
    const { error } = await supabase
      .from("stock_session_items")
      .update({
        new_name: name && name !== it.product.name ? name : null,
        new_sell_price: price,
        notes: it.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    setSaving(false);
    if (error) setFlash({ type: "err", text: `Couldn't save changes: ${error.message}` });
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

  async function uploadPhoto(file: File, folder: string): Promise<string | null> {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("stock-photos").upload(path, file, {
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (error) return null;
    const { data } = supabase.storage.from("stock-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  // --- "Not in the catalogue" rows: add a description / photo -------------

  function toggleUnmatchedForm(rowId: string) {
    setUnmatchedDrafts((prev) => ({
      ...prev,
      [rowId]: prev[rowId] ? { ...prev[rowId], open: !prev[rowId].open } : { ...emptyUnmatchedDraft },
    }));
  }

  function updateUnmatchedDraft(rowId: string, patch: Partial<UnmatchedDraft>) {
    setUnmatchedDrafts((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? emptyUnmatchedDraft), ...patch },
    }));
  }

  async function saveUnmatchedDetails(rowId: string) {
    const draft = unmatchedDrafts[rowId];
    if (!draft || draft.saving) return;
    const name = draft.productName.trim();
    if (!name && !draft.description.trim() && !draft.file) {
      setFlash({ type: "err", text: "Add a product name (or at least a note or photo) first." });
      return;
    }
    const sell = toNumberOrNull(draft.sellPrice);
    const cost = toNumberOrNull(draft.costPrice);
    const size = toNumberOrNull(draft.sizeMl);
    const qty = toNumberOrNull(draft.quantity);
    if (
      (draft.sellPrice.trim() && sell === null) ||
      (draft.costPrice.trim() && cost === null) ||
      (draft.sizeMl.trim() && size === null) ||
      (draft.quantity.trim() && qty === null)
    ) {
      setFlash({ type: "err", text: "Prices, size and quantity need to be numbers." });
      return;
    }
    updateUnmatchedDraft(rowId, { saving: true });

    let imageUrl: string | null = null;
    if (draft.file) {
      imageUrl = await uploadPhoto(draft.file, `unmatched/${sessionId}`);
    }

    const update: Record<string, unknown> = {
      resolved: true,
      product_name: name || null,
      sell_price: sell,
      cost_price: cost,
      category: draft.category.trim() || null,
      container: name ? draft.container || "BOTTLE" : null,
      size_ml: size,
      quantity: qty,
    };
    if (draft.description.trim()) update.description = draft.description.trim();
    if (imageUrl) update.image_url = imageUrl;

    const { data, error } = await supabase
      .from("stock_session_unmatched")
      .update(update)
      .eq("id", rowId)
      .select("id, description, image_url, product_name, sell_price, quantity")
      .single();

    if (!error && data) {
      setUnmatched((prev) =>
        prev.map((u) =>
          u.rowId === rowId
            ? {
                ...u,
                description: data.description,
                imageUrl: data.image_url,
                productName: data.product_name,
                sellPrice: data.sell_price,
                quantity: data.quantity,
              }
            : u
        )
      );
      setUnmatchedDrafts((prev) => ({ ...prev, [rowId]: { ...emptyUnmatchedDraft, open: false } }));
      setFlash({
        type: "ok",
        text: name ? `${name} saved. It'll be in the Product CSV as a new product.` : "Details saved, thanks!",
      });
      focusInput();
    } else {
      updateUnmatchedDraft(rowId, { saving: false });
      setFlash({ type: "err", text: `Couldn't save those details: ${error?.message ?? "try again"}` });
    }
  }

  // --- Matched product rows: flag "this isn't the right product" ----------

  function toggleIncorrectForm(rowId: string) {
    setIncorrectDrafts((prev) => ({
      ...prev,
      [rowId]: prev[rowId] ? { ...prev[rowId], open: !prev[rowId].open } : { ...emptyIncorrectDraft },
    }));
  }

  function updateIncorrectDraft(rowId: string, patch: Partial<IncorrectDraft>) {
    setIncorrectDrafts((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? emptyIncorrectDraft), ...patch },
    }));
  }

  async function submitIncorrect(rowId: string, product: Product) {
    const draft = incorrectDrafts[rowId];
    if (!draft || draft.saving || !sessionId) return;
    updateIncorrectDraft(rowId, { saving: true });

    let imageUrl: string | null = null;
    if (draft.file) {
      imageUrl = await uploadPhoto(draft.file, `incorrect/${sessionId}`);
    }

    const { error } = await supabase.from("stock_session_incorrect_matches").insert({
      session_id: sessionId,
      product_id: product.id,
      scanned_value: product.barcode ?? product.sku,
      description: draft.description.trim() || null,
      image_url: imageUrl,
      flagged_by: userEmail,
    });

    if (!error) {
      setIncorrectDrafts((prev) => ({
        ...prev,
        [rowId]: { open: false, description: "", file: null, saving: false, done: true },
      }));
      setFlash({ type: "ok", text: "Reported — a manager will fix the catalogue entry." });
    } else {
      updateIncorrectDraft(rowId, { saving: false });
      setFlash({ type: "err", text: "Couldn't send that report, try again." });
    }
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
    setFlash({ type: "ok", text: "Stock count CSV downloaded. Upload it to Lightspeed under Inventory → Stock counts." });
  }

  function exportUnmatchedCsv() {
    if (unmatched.length === 0) return;
    const csv = buildUnmatchedCsv(
      unmatched.map((u) => ({
        value: u.value,
        scanned_by: userEmail,
        scanned_at: u.at,
        description: u.description,
        image_url: u.imageUrl,
        product_name: u.productName,
        sell_price: u.sellPrice,
        quantity: u.quantity,
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
    setUnmatchedDrafts({});
    setIncorrectDrafts({});
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
            {items.map((it) => {
              const incorrect = incorrectDrafts[it.rowId];
              return (
                <li
                  key={it.rowId}
                  id={`row-${it.rowId}`}
                  className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm"
                >
                  <div className="flex items-center gap-3">
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
                  </div>

                  {(it.newName.trim() || it.newPrice.trim() || it.notes.trim()) && !it.editOpen && (
                    <div className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700">
                      {it.newName.trim() && it.newName.trim() !== it.product.name && (
                        <div>New name: {it.newName.trim()}</div>
                      )}
                      {it.newPrice.trim() && <div>New price: ${it.newPrice.trim()}</div>}
                      {it.notes.trim() && <div>Note: {it.notes.trim()}</div>}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button
                      onClick={() => {
                        if (it.editOpen) persistEdits(it.rowId);
                        updateLocalItem(it.rowId, { editOpen: !it.editOpen });
                      }}
                      className="text-xs font-medium text-brand underline"
                    >
                      {it.editOpen ? "Done" : "Change name / price / add note"}
                    </button>
                    {incorrect?.done ? (
                      <div className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                        ⚠ Reported as wrong product
                      </div>
                    ) : (
                      <button
                        onClick={() => toggleIncorrectForm(it.rowId)}
                        className="text-xs font-medium text-gray-400 underline"
                      >
                        {incorrect?.open ? "Cancel" : "This isn't the right product"}
                      </button>
                    )}
                  </div>

                  {it.editOpen && (
                    <div className="flex flex-col gap-2 rounded-lg bg-blue-50/60 p-3">
                      {looksLikeBarcode(it.product.name) && (
                        <p className="text-xs font-medium text-blue-700">
                          This product only has its barcode as a name. What is it? e.g. brand, variety, size
                        </p>
                      )}
                      <label className="text-xs font-medium text-gray-600">
                        Product name
                        <input
                          value={it.newName}
                          onChange={(e) => updateLocalItem(it.rowId, { newName: e.target.value })}
                          onBlur={() => persistEdits(it.rowId)}
                          placeholder={looksLikeBarcode(it.product.name) ? "e.g. Great Northern Original 6x375ml Cans" : it.product.name}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                        />
                      </label>
                      <label className="text-xs font-medium text-gray-600">
                        New sell price (inc GST)
                        <input
                          value={it.newPrice}
                          onChange={(e) => updateLocalItem(it.rowId, { newPrice: e.target.value })}
                          onBlur={() => persistEdits(it.rowId)}
                          inputMode="decimal"
                          placeholder="Leave blank to keep the current price"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                        />
                      </label>
                      <label className="text-xs font-medium text-gray-600">
                        Notes
                        <textarea
                          value={it.notes}
                          onChange={(e) => updateLocalItem(it.rowId, { notes: e.target.value })}
                          onBlur={() => persistEdits(it.rowId)}
                          rows={2}
                          placeholder="Anything a manager should know"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                        />
                      </label>
                    </div>
                  )}

                  {incorrect?.open && !incorrect?.done && (
                    <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs text-gray-500">
                        The barcode matched this product, but it's not what's actually on the
                        shelf. Tell us what it really is so a manager can fix the catalogue.
                      </p>
                      <textarea
                        value={incorrect.description}
                        onChange={(e) => updateIncorrectDraft(it.rowId, { description: e.target.value })}
                        placeholder="What is this item actually?"
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) =>
                          updateIncorrectDraft(it.rowId, { file: e.target.files?.[0] ?? null })
                        }
                        className="text-xs text-gray-500"
                      />
                      <button
                        onClick={() => submitIncorrect(it.rowId, it.product)}
                        disabled={incorrect.saving}
                        className="rounded-lg bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {incorrect.saving ? "Sending…" : "Report incorrect product"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
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
              <ul className="flex flex-col gap-2">
                {unmatched.map((u) => {
                  const draft = unmatchedDrafts[u.rowId];
                  const hasDetails = Boolean(u.productName || u.description || u.imageUrl);
                  return (
                    <li key={u.rowId} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {u.value} <span className="text-amber-400">· {u.at}</span>
                        </span>
                        {!hasDetails && (
                          <button
                            onClick={() => toggleUnmatchedForm(u.rowId)}
                            className="whitespace-nowrap text-xs font-medium text-amber-700 underline"
                          >
                            {draft?.open ? "Cancel" : "Add as new product"}
                          </button>
                        )}
                      </div>

                      {hasDetails && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-amber-700">
                          <span>
                            {u.productName
                              ? `✓ New product: ${u.productName}${u.sellPrice !== null ? ` · $${u.sellPrice}` : ""}${
                                  u.quantity !== null ? ` · qty ${u.quantity}` : ""
                                }`
                              : `✓ Details added${u.description ? `: ${u.description}` : ""}`}
                          </span>
                          {u.imageUrl && (
                            <a href={u.imageUrl} target="_blank" rel="noreferrer" className="underline">
                              View photo
                            </a>
                          )}
                        </div>
                      )}

                      {draft?.open && !hasDetails && (
                        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-white p-3">
                          <label className="text-xs font-medium text-gray-600">
                            Product name
                            <input
                              value={draft.productName}
                              onChange={(e) => updateUnmatchedDraft(u.rowId, { productName: e.target.value })}
                              placeholder="e.g. Hahn Super Dry 6x330ml Bottles"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs font-medium text-gray-600">
                              Sell price (inc GST)
                              <input
                                value={draft.sellPrice}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { sellPrice: e.target.value })}
                                inputMode="decimal"
                                placeholder="24.99"
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                              />
                            </label>
                            <label className="text-xs font-medium text-gray-600">
                              Cost (inc GST, optional)
                              <input
                                value={draft.costPrice}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { costPrice: e.target.value })}
                                inputMode="decimal"
                                placeholder="15.20"
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                              />
                            </label>
                            <label className="text-xs font-medium text-gray-600">
                              Container
                              <select
                                value={draft.container}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { container: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-normal text-gray-800"
                              >
                                {CONTAINERS.map((c) => (
                                  <option key={c} value={c}>
                                    {c.charAt(0) + c.slice(1).toLowerCase()}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs font-medium text-gray-600">
                              Size in ml (optional)
                              <input
                                value={draft.sizeMl}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { sizeMl: e.target.value })}
                                inputMode="decimal"
                                placeholder="750"
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                              />
                            </label>
                            <label className="text-xs font-medium text-gray-600">
                              Category
                              <input
                                list={`cats-${u.rowId}`}
                                value={draft.category}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { category: e.target.value })}
                                placeholder="e.g. Red Wine"
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                              />
                              <datalist id={`cats-${u.rowId}`}>
                                {categories.map((c) => (
                                  <option key={c} value={c} />
                                ))}
                              </datalist>
                            </label>
                            <label className="text-xs font-medium text-gray-600">
                              Qty on hand
                              <input
                                value={draft.quantity}
                                onChange={(e) => updateUnmatchedDraft(u.rowId, { quantity: e.target.value })}
                                inputMode="decimal"
                                placeholder="0"
                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-800"
                              />
                            </label>
                          </div>
                          <label className="text-xs font-medium text-gray-600">
                            Notes
                            <textarea
                              value={draft.description}
                              onChange={(e) => updateUnmatchedDraft(u.rowId, { description: e.target.value })}
                              placeholder="Anything else, e.g. supplier, where it's shelved"
                              rows={2}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm font-normal text-gray-700"
                            />
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) =>
                              updateUnmatchedDraft(u.rowId, { file: e.target.files?.[0] ?? null })
                            }
                            className="text-xs text-gray-500"
                          />
                          <button
                            onClick={() => saveUnmatchedDetails(u.rowId)}
                            disabled={draft.saving}
                            className="rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-40"
                          >
                            {draft.saving ? "Saving…" : "Save product"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-xs text-gray-400">
                Fill in the details to add these as new products in the Product CSV. Their counts
                go in once they're in Lightspeed (they need a Lightspeed ID first), so the qty is
                kept in the Unmatched CSV. Until then, ring them up through Snacks → Unidentified
                Beverage with the barcode in Order notes, per the POS SOP.
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
            New count
          </button>
          {sessionId && (
            <ProductImportButton sessionId={sessionId} venueId={venueId} venueName={venueName} />
          )}
          <button
            onClick={exportCsv}
            disabled={items.length === 0}
            className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-40"
          >
            Stock CSV
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
