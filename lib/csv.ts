export type CsvRow = {
    lightspeed_product_id: string;
    name: string;
    quantity: number | string;
};

function quote(value: string) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Builds a CSV that matches Lightspeed's own stock-count import template
 * exactly: "id","name","count" — so it can be uploaded straight back in.
 */
export function buildStockCountCsv(rows: CsvRow[]) {
    const header = `"id","name","count"`;
    const lines = rows.map(
          (r) => `${quote(r.lightspeed_product_id)},${quote(r.name)},${quote(String(r.quantity ?? ""))}`
        );
    return [header, ...lines].join("\n");
}

export type UnmatchedRow = {
    value: string;
    scanned_by: string;
    scanned_at: string;
    description?: string | null;
    image_url?: string | null;
    product_name?: string | null;
    sell_price?: number | string | null;
    quantity?: number | string | null;
};

/**
 * Builds a CSV of barcodes/SKUs that were scanned during a count but didn't
 * match anything in the products catalogue — so they can be reviewed and
 * added to Lightspeed / the catalogue later. Includes any description/photo
 * staff added on the device.
 */
export function buildUnmatchedCsv(rows: UnmatchedRow[]) {
    const header = `"value","product_name","sell_price","quantity","scanned_by","scanned_at","description","image_url"`;
    const lines = rows.map((r) =>
        [
            r.value,
            r.product_name ?? "",
            r.sell_price ?? "",
            r.quantity ?? "",
            r.scanned_by,
            r.scanned_at,
            r.description ?? "",
            r.image_url ?? "",
        ]
            .map((v) => quote(String(v)))
            .join(",")
    );
    return [header, ...lines].join("\n");
}

export type IncorrectMatchRow = {
    product_name: string;
    barcode: string;
    description: string;
    image_url: string;
    flagged_by: string;
    flagged_at: string;
};

/**
 * Builds a CSV of products staff flagged as wrong during a count — the
 * barcode scanned a product, but it wasn't actually the item on the shelf.
 */
export function buildIncorrectMatchesCsv(rows: IncorrectMatchRow[]) {
    const header = `"product_name","barcode","description","image_url","flagged_by","flagged_at"`;
    const lines = rows.map(
          (r) =>
                  `${quote(r.product_name)},${quote(r.barcode)},${quote(r.description)},${quote(
                            r.image_url
                          )},${quote(r.flagged_by)},${quote(r.flagged_at)}`
        );
    return [header, ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Lightspeed product import CSV
// ---------------------------------------------------------------------------

/** Column order of Lightspeed (O-Series / Kounta) product export + import. */
export const LIGHTSPEED_PRODUCT_COLUMNS = [
  "ProductID",
  "ProductNo",
  "ProductName",
  "DocketName",
  "Barcode",
  "SKU",
  "Unit",
  "DefaultSize",
  "SellPriceIncTax",
  "SellTaxCode",
  "CostPriceIncTax",
  "CostTaxCode",
  "IsModifier",
  "PrintDocket",
  "Tags",
  "CategoryNames",
  "SellAccount",
  "BuyAccount",
  "InventoryAccount",
  "ImageUrl",
  "ReportingGroup",
  "FriendlyName",
  "ShowOnline",
  "OnlineDescription",
  "InventoryType",
  "PurchaseFormat",
  "PurchaseQty",
  "Container",
  "VariableQtyPrompt",
] as const;

export type LightspeedRow = Record<string, string>;

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): LightspeedRow[] {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push(row);
  }
  const [header, ...body] = records.filter((r) => r.some((v) => v !== ""));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

export type ProductUpdate = {
  lightspeed_product_id: string;
  current_name: string;
  barcode: string | null;
  sku: string | null;
  new_name: string | null;
  new_sell_price: number | null;
  notes: string | null;
};

export type NewProduct = {
  barcode: string;
  product_name: string;
  sell_price: number | null;
  cost_price: number | null;
  category: string | null;
  container: string | null;
  size_ml: number | null;
  notes: string | null;
};

export type ProductImportResult = {
  csv: string;
  updated: number;
  created: number;
  /** Updates that couldn't be found in the uploaded export (written from app data only). */
  notInExport: string[];
  usedExport: boolean;
};

function money(n: number) {
  return n.toFixed(2);
}

/**
 * Builds a Lightspeed product import CSV from the edits made during a count.
 *
 * Existing products: if the venue's latest Lightspeed product export is
 * supplied, each changed product's full export row is copied and only the
 * name / sell price are changed, so nothing else on the product gets blanked
 * by the import. Without the export, only the identifying columns plus the
 * changed fields are written (riskier, and flagged in the UI).
 *
 * New products: ProductID left blank so Lightspeed creates them, set up as
 * sell + buy + stock-tracked items in the venue's reporting group.
 */
export function buildProductImportCsv(opts: {
  updates: ProductUpdate[];
  newProducts: NewProduct[];
  baseExport?: LightspeedRow[] | null;
  reportingGroup: string;
  tagDate: string; // YYYY-MM-DD
}): ProductImportResult {
  const { updates, newProducts, baseExport, reportingGroup, tagDate } = opts;
  const byId = new Map<string, LightspeedRow>();
  const byBarcode = new Map<string, LightspeedRow>();
  for (const r of baseExport ?? []) {
    if (r.ProductID) byId.set(r.ProductID, r);
    if (r.Barcode) byBarcode.set(r.Barcode, r);
  }
  const groupFromExport =
    (baseExport ?? []).find((r) => r.ReportingGroup)?.ReportingGroup || reportingGroup;

  const out: LightspeedRow[] = [];
  const notInExport: string[] = [];

  for (const u of updates) {
    if (!u.new_name && u.new_sell_price === null) continue;
    const base =
      byId.get(u.lightspeed_product_id) ?? (u.barcode ? byBarcode.get(u.barcode) : undefined);
    let row: LightspeedRow;
    if (base) {
      row = { ...base };
    } else {
      if (baseExport) notInExport.push(u.new_name || u.current_name);
      row = {
        ProductID: u.lightspeed_product_id,
        ProductName: u.current_name,
        Barcode: u.barcode ?? "",
        SKU: u.sku ?? "",
      };
    }
    if (u.new_name) {
      row.ProductName = u.new_name;
      // Placeholder products were created with this note; clear it once named.
      if (/identify product before import|no matching product/i.test(row.OnlineDescription ?? "")) {
        row.OnlineDescription = "";
      }
    }
    if (u.new_sell_price !== null) row.SellPriceIncTax = money(u.new_sell_price);
    out.push(row);
  }

  const seen = new Set<string>();
  let created = 0;
  for (const p of newProducts) {
    if (!p.product_name || seen.has(p.barcode)) continue;
    seen.add(p.barcode);
    const hasSize = p.size_ml !== null && p.size_ml > 0;
    out.push({
      ProductID: "",
      ProductNo: "",
      ProductName: p.product_name,
      DocketName: "",
      Barcode: p.barcode,
      SKU: "",
      Unit: hasSize ? "ml" : "unit",
      DefaultSize: hasSize ? String(p.size_ml) : "1",
      SellPriceIncTax: p.sell_price !== null ? money(p.sell_price) : "0",
      SellTaxCode: "GST",
      CostPriceIncTax: p.cost_price !== null ? p.cost_price.toFixed(4) : "0.0000",
      CostTaxCode: "GST",
      IsModifier: "0",
      PrintDocket: "0",
      Tags: `Beverages,stock-count-${tagDate}-new`,
      CategoryNames: p.category ?? "",
      SellAccount: "1",
      BuyAccount: "1",
      InventoryAccount: "1",
      ImageUrl: "",
      ReportingGroup: groupFromExport,
      FriendlyName: "",
      ShowOnline: "",
      OnlineDescription: "",
      InventoryType: "1",
      PurchaseFormat: "Individual",
      PurchaseQty: "1",
      Container: (p.container || "BOTTLE").toUpperCase(),
      VariableQtyPrompt: "",
    });
    created++;
  }

  const header = LIGHTSPEED_PRODUCT_COLUMNS.join(",");
  const lines = out.map((r) =>
    LIGHTSPEED_PRODUCT_COLUMNS.map((c) => {
      const v = r[c] ?? "";
      return /[",\n\r]/.test(v) ? quote(v) : v;
    }).join(",")
  );

  return {
    csv: [header, ...lines].join("\n"),
    updated: out.length - created,
    created,
    notInExport,
    usedExport: Boolean(baseExport && baseExport.length),
  };
}
