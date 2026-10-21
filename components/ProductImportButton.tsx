"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  buildProductImportCsv,
  downloadCsv,
  parseCsv,
  type LightspeedRow,
  type NewProduct,
  type ProductUpdate,
} from "@/lib/csv";

/**
 * Builds the Lightspeed product import CSV for one count: price / name
 * changes to scanned products, plus new products for barcodes that didn't
 * match. Staff can attach the venue's latest Lightspeed product export so
 * updated products keep every other field exactly as Lightspeed has it.
 */
export default function ProductImportButton({
  sessionId,
  venueId,
  venueName,
  variant = "bar",
}: {
  sessionId: string;
  venueId: string;
  venueName: string;
  variant?: "bar" | "history";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportRows, setExportRows] = useState<LightspeedRow[] | null>(null);
  const [exportName, setExportName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onPickExport(file: File | null) {
    setMessage(null);
    if (!file) {
      setExportRows(null);
      setExportName(null);
      return;
    }
    const rows = parseCsv(await file.text());
    if (!rows.length || !("ProductID" in rows[0]) || !("SellPriceIncTax" in rows[0])) {
      setExportRows(null);
      setExportName(null);
      setMessage({
        type: "err",
        text: "That doesn't look like a Lightspeed product export (no ProductID / SellPriceIncTax columns).",
      });
      return;
    }
    setExportRows(rows);
    setExportName(`${file.name} (${rows.length} products)`);

    // Keep the prices shown on the scan screen current.
    const supabase = createClient();
    const { data: updated, error } = await supabase.rpc("refresh_product_prices", {
      p_venue_id: venueId,
      prices: rows
        .filter((r) => r.SellPriceIncTax !== undefined && r.SellPriceIncTax !== "")
        .map((r) => ({ id: r.ProductID, barcode: r.Barcode, price: r.SellPriceIncTax })),
    });
    if (error) {
      setMessage({ type: "err", text: `Couldn't refresh prices from that export: ${error.message}` });
    } else {
      setMessage({
        type: "ok",
        text: `Lightspeed prices refreshed for ${updated ?? 0} products. Rescan an item to see its new price.`,
      });
    }
  }

  async function build() {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();

    const [{ data: itemRows, error: itemsErr }, { data: newRows, error: newErr }, { data: rg }] =
      await Promise.all([
        supabase
          .from("stock_session_items")
          .select("new_name, new_sell_price, notes, product:products(lightspeed_product_id, name, barcode, sku)")
          .eq("session_id", sessionId)
          .or("new_name.not.is.null,new_sell_price.not.is.null"),
        supabase
          .from("stock_session_unmatched")
          .select("value, product_name, sell_price, cost_price, category, container, size_ml, description")
          .eq("session_id", sessionId)
          .not("product_name", "is", null),
        supabase
          .from("products")
          .select("reporting_group")
          .eq("venue_id", venueId)
          .not("reporting_group", "is", null)
          .limit(1)
          .maybeSingle(),
      ]);

    if (itemsErr || newErr) {
      setMessage({ type: "err", text: `Couldn't load this count's edits: ${(itemsErr ?? newErr)!.message}` });
      setBusy(false);
      return;
    }

    const updates: ProductUpdate[] = (itemRows ?? [])
      .filter((r: any) => r.product)
      .map((r: any) => ({
        lightspeed_product_id: r.product.lightspeed_product_id,
        current_name: r.product.name,
        barcode: r.product.barcode,
        sku: r.product.sku,
        new_name: r.new_name?.trim() || null,
        new_sell_price: r.new_sell_price === null ? null : Number(r.new_sell_price),
        notes: r.notes,
      }));

    const newProducts: NewProduct[] = (newRows ?? []).map((r: any) => ({
      barcode: r.value,
      product_name: r.product_name.trim(),
      sell_price: r.sell_price === null ? null : Number(r.sell_price),
      cost_price: r.cost_price === null ? null : Number(r.cost_price),
      category: r.category,
      container: r.container,
      size_ml: r.size_ml === null ? null : Number(r.size_ml),
      notes: r.description,
    }));

    if (!updates.length && !newProducts.length) {
      setMessage({
        type: "err",
        text: "Nothing to import yet. Change a name or price on a scanned item, or add a product for an unmatched barcode.",
      });
      setBusy(false);
      return;
    }

    if (updates.length && !exportRows) {
      setMessage({
        type: "err",
        text: `This count changes ${updates.length} existing product${updates.length === 1 ? "" : "s"}. Attach the latest Lightspeed product export above first, so those rows import cleanly.`,
      });
      setBusy(false);
      return;
    }

    const result = buildProductImportCsv({
      updates,
      newProducts,
      baseExport: exportRows,
      reportingGroup: (rg as any)?.reporting_group || venueName,
      tagDate: new Date().toISOString().slice(0, 10),
    });

    downloadCsv(`${venueId}-product-import-${new Date().toISOString().slice(0, 10)}.csv`, result.csv);

    const parts = [`${result.updated} updated`, `${result.created} new`];
    let text = `Product import CSV downloaded (${parts.join(", ")}). Import it in Lightspeed Back Office under Products, then check the changes.`;
    if (result.notInExport.length) {
      text += ` ${result.notInExport.length} change${result.notInExport.length === 1 ? " isn't" : "s aren't"} in the file because the product isn't in that export (deleted, or not on this site). Do these by hand in Back Office: ${result.notInExport
        .map((n) => `${n.name} (${n.change})`)
        .join("; ")}.`;
    }
    setMessage({ type: result.notInExport.length ? "err" : "ok", text });
    setBusy(false);
  }

  const trigger =
    variant === "bar" ? (
      <button
        onClick={() => setOpen(true)}
        className="flex-1 rounded-xl border-2 border-brand py-3 font-semibold text-brand"
      >
        Product CSV
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand"
      >
        Product import CSV
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-navy">Product import CSV</h2>
            <p className="mb-4 text-sm text-gray-500">
              Name and price changes from this count, plus new products for barcodes that weren't
              found. Import it in Lightspeed under Products.
            </p>

            <label className="mb-1 block text-sm font-medium text-gray-700">
              Latest Lightspeed product export for {venueName}{" "}
              <span className="font-normal text-gray-400">(Back Office → Products → Export)</span>
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onPickExport(e.target.files?.[0] ?? null)}
              className="mb-1 w-full text-sm text-gray-600"
            />
            <p className="mb-4 text-xs text-gray-400">
              {exportName
                ? `Using ${exportName}. Changed products keep all their other Lightspeed settings.`
                : "Needed for name or price changes. Not needed if the count only adds new products."}
            </p>

            {message && (
              <div
                className={`mb-3 rounded-lg px-3 py-2 text-sm ${
                  message.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl border border-gray-300 py-3 font-medium text-gray-600"
              >
                Close
              </button>
              <button
                onClick={build}
                disabled={busy}
                className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Building…" : "Download"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
