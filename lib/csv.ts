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
