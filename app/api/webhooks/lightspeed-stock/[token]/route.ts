import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Receives the "Stock Count Product Feed" Look scheduled out of Lightspeed
 * Insights (format: JSON — Simple, Inline) and keeps `venues`, `products`
 * and `product_stock_levels` in sync.
 *
 * The Insights "Stock Level" explore doesn't expose Lightspeed's real
 * internal product id, so we can't blindly trust "Product Number" as the
 * identity key — for the Bottle Shop venue that would silently disconnect
 * every row from the real Lightspeed ids already seeded (from Lightspeed's
 * own product export) and break the CSV re-import workflow. Instead we
 * match onto an existing product by barcode, then SKU, and only fall back
 * to Product Number (or barcode/SKU) as the id for products we've never
 * seen before. (There's no separate "Lightspeed Product ID" field exposed
 * by this explore — Product Number is the closest thing to it.)
 *
 * Also carries POS Category and Reporting Group through onto `products`,
 * for reporting.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "venue"
  );
}

/** Looker sometimes wraps values as {value, rendered}; unwrap defensively. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).value;
  }
  return v;
}

function clean(v: unknown): string | null {
  const u = unwrap(v);
  if (u === null || u === undefined) return null;
  const s = String(u).trim();
  if (!s || s === "Ø" || s.toLowerCase() === "null") return null;
  return s;
}

/** Strip everything but letters/digits so "product_name", "Product Name" and
 * "products.name" all normalize the same way. */
function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Match a Looker field by fuzzy key substring — robust to the exact LookML field id,
 * whether it's snake_case ("product_name"), a display label ("Product Name"), or
 * dotted ("products.name" — note the plural view name, hence "products" not "product"). */
function pick(row: Record<string, unknown>, ...substrings: string[]): unknown {
  const wanted = substrings.map(normKey);
  for (const key of Object.keys(row)) {
    const nk = normKey(key);
    if (wanted.some((w) => nk.includes(w))) return row[key];
  }
  return undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const expected = process.env.LIGHTSPEED_WEBHOOK_SECRET;
  if (!expected || params.token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = admin();
  const counters = {
    rows_received: 0,
    venues_created: 0,
    products_upserted: 0,
    stock_levels_upserted: 0,
    skipped_no_site: 0,
    skipped_no_name: 0,
    skipped_no_identity: 0,
  };

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid json body" }, { status: 400 });
    }

    const rows: Record<string, unknown>[] = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : Array.isArray((body as any)?.data)
      ? (body as any).data
      : Array.isArray((body as any)?.attachment?.data)
      ? (body as any).attachment.data
      : [];

    counters.rows_received = rows.length;
    const sampleKeys = rows.length ? Object.keys(rows[0]).join(", ") : null;

    if (!rows.length) {
      return NextResponse.json(
        {
          error: "no rows found in payload",
          receivedShape: body && typeof body === "object" ? Object.keys(body as object) : typeof body,
        },
        { status: 400 }
      );
    }

    // Existing venues, for name -> id lookup + de-duping newly-seen sites.
    const { data: existingVenues, error: venuesErr } = await supabase.from("venues").select("id, name");
    if (venuesErr) throw venuesErr;
    const venueByName = new Map((existingVenues ?? []).map((v) => [v.name.toLowerCase(), v.id]));
    const venueIds = new Set((existingVenues ?? []).map((v) => v.id));
    const venuesToInsert = new Map<string, { id: string; name: string }>();

    // Existing products, for barcode/SKU/id matching.
    const { data: existingProducts, error: productsErr } = await supabase
      .from("products")
      .select("id, venue_id, lightspeed_product_id, sku, barcode");
    if (productsErr) throw productsErr;

    const byBarcode = new Map<string, (typeof existingProducts)[number]>();
    const bySku = new Map<string, (typeof existingProducts)[number]>();
    const byLsId = new Map<string, (typeof existingProducts)[number]>();
    for (const p of existingProducts ?? []) {
      if (p.barcode) byBarcode.set(`${p.venue_id}|${p.barcode}`, p);
      if (p.sku) bySku.set(`${p.venue_id}|${p.sku}`, p);
      byLsId.set(`${p.venue_id}|${p.lightspeed_product_id}`, p);
    }

    type ProductUpsert = {
      venue_id: string;
      lightspeed_product_id: string;
      name: string;
      sku: string | null;
      barcode: string | null;
      pos_category: string | null;
      reporting_group: string | null;
      is_active: boolean;
    };
    const productUpserts = new Map<string, ProductUpsert>(); // key: venue_id|lightspeed_product_id
    const quantityByKey = new Map<string, number>(); // same key -> quantity

    for (const row of rows) {
      const siteName = clean(pick(row, "site_name") ?? pick(row, "site.name") ?? pick(row, "site"));
      const productName = clean(
        pick(row, "product_name", "products.name", "products name", "product.name")
      );
      const productNumber = clean(pick(row, "product_number"));
      const barcode = clean(pick(row, "barcode"));
      const sku = clean(pick(row, "sku"));
      const posCategory = clean(pick(row, "pos_category_name", "pos category name"));
      const reportingGroup = clean(pick(row, "reporting_group_name", "reporting group name"));
      const quantityRaw = unwrap(pick(row, "quantity"));

      if (!siteName) {
        counters.skipped_no_site++;
        continue;
      }
      if (!productName) {
        counters.skipped_no_name++;
        continue;
      }

      let venueId = venueByName.get(siteName.toLowerCase());
      if (!venueId) {
        venueId = slugify(siteName);
        let candidate = venueId;
        let n = 2;
        while (venueIds.has(candidate)) candidate = `${venueId}-${n++}`;
        venueId = candidate;
        venueIds.add(venueId);
        venueByName.set(siteName.toLowerCase(), venueId);
        venuesToInsert.set(venueId, { id: venueId, name: siteName });
      }

      // Prefer matching an already-known product (never invent a new identity
      // for a product we can already recognise by barcode/SKU).
      let existing = barcode ? byBarcode.get(`${venueId}|${barcode}`) : undefined;
      if (!existing && sku) existing = bySku.get(`${venueId}|${sku}`);
      if (!existing && productNumber) existing = byLsId.get(`${venueId}|${productNumber}`);

      const lightspeedId = existing?.lightspeed_product_id ?? productNumber ?? barcode ?? sku ?? null;
      if (!lightspeedId) {
        counters.skipped_no_identity++;
        continue;
      }

      const key = `${venueId}|${lightspeedId}`;
      productUpserts.set(key, {
        venue_id: venueId,
        lightspeed_product_id: lightspeedId,
        name: productName,
        sku,
        barcode,
        pos_category: posCategory,
        reporting_group: reportingGroup,
        is_active: true,
      });

      const quantity = quantityRaw === undefined || quantityRaw === null ? NaN : Number(quantityRaw);
      if (!Number.isNaN(quantity)) quantityByKey.set(key, quantity);
    }

    // 1. Insert any newly-seen venues.
    if (venuesToInsert.size) {
      const rowsToInsert = Array.from(venuesToInsert.values());
      const { error } = await supabase.from("venues").upsert(rowsToInsert, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      counters.venues_created = rowsToInsert.length;
    }

    // 2. Upsert products, in chunks, collecting back their ids.
    const productIdByKey = new Map<string, string>();
    for (const p of existingProducts ?? []) {
      productIdByKey.set(`${p.venue_id}|${p.lightspeed_product_id}`, p.id);
    }
    const allUpserts = Array.from(productUpserts.entries());
    for (const batch of chunk(allUpserts, 500)) {
      const { data, error } = await supabase
        .from("products")
        .upsert(
          batch.map(([, v]) => v),
          { onConflict: "venue_id,lightspeed_product_id" }
        )
        .select("id, venue_id, lightspeed_product_id");
      if (error) throw error;
      for (const row of data ?? []) {
        productIdByKey.set(`${row.venue_id}|${row.lightspeed_product_id}`, row.id);
      }
      counters.products_upserted += batch.length;
    }

    // 3. Upsert live stock levels now that every product has an id.
    const stockLevelRows = Array.from(quantityByKey.entries())
      .map(([key, quantity]) => {
        const productId = productIdByKey.get(key);
        if (!productId) return null;
        const [venueId] = key.split("|");
        return {
          product_id: productId,
          venue_id: venueId,
          quantity,
          lightspeed_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    for (const batch of chunk(stockLevelRows, 500)) {
      const { error } = await supabase.from("product_stock_levels").upsert(batch, { onConflict: "product_id" });
      if (error) throw error;
      counters.stock_levels_upserted += batch.length;
    }

    await supabase.from("webhook_runs").insert({ ...counters, sample_keys: sampleKeys });

    return NextResponse.json({ ok: true, ...counters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin()
      .from("webhook_runs")
      .insert({ ...counters, error: message })
      .then(() => {});
    return NextResponse.json({ ok: false, error: message, ...counters }, { status: 500 });
  }
}

/** Lets Lightspeed (or you) confirm the endpoint is alive without sending real data. */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const expected = process.env.LIGHTSPEED_WEBHOOK_SECRET;
  if (!expected || params.token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, message: "lightspeed-stock webhook is live" });
}
