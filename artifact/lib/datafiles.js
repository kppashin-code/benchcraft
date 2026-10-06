// Ported from benchcraft/datafiles.py; files are profiled in the browser.
export const ALLOWED = {
  ".csv": "table", ".tsv": "table", ".txt": "table",
  ".xlsx": "spreadsheet", ".xls": "spreadsheet", ".json": "table",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".tif": "image", ".tiff": "image",
  ".pdf": "document",
};
export const MAX_BYTES = 20 * 1024 * 1024;

export const suffixOf = (name) => { const m = /\.[^.]+$/.exec(name || ""); return m ? m[0].toLowerCase() : ""; };

export function check(filename, size) {
  const suffix = suffixOf(filename);
  if (!(suffix in ALLOWED)) {
    throw new Error(`'${suffix || "that"}' is not a type Benchcraft stores. Allowed: ${Object.keys(ALLOWED).sort().join(", ")}`);
  }
  if (size > MAX_BYTES) throw new Error(`That file is ${(size / 1e6).toFixed(0)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB.`);
  return ALLOWED[suffix];
}

const isNumber = (v) => v.trim() !== "" && Number.isFinite(Number(v));

function sniff(sample) {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const consistent = counts.length && counts.every((c) => c === counts[0]) ? counts[0] : 0;
    if (consistent > bestScore) { best = d; bestScore = consistent; }
  }
  return best;
}

export function parse(raw) {
  const delim = sniff(raw.slice(0, 4000));
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function profile(filename, raw) {
  const suffix = suffixOf(filename);
  if (ALLOWED[suffix] !== "table" || suffix === ".json") return { n_rows: null, n_cols: null, columns: [] };
  if (!raw.trim()) return { n_rows: 0, n_cols: 0, columns: [] };
  const rows = parse(raw);
  if (!rows.length) return { n_rows: 0, n_cols: 0, columns: [] };
  let header = rows[0], body = rows.slice(1);
  if (header.filter((c) => c.trim()).every(isNumber)) {
    header = rows[0].map((_, i) => `col${i + 1}`);
    body = rows;
  }
  const columns = header.map((name, i) => {
    const values = body.map((r) => r[i]).filter((v) => v !== undefined && v.trim() !== "");
    const nums = values.filter(isNumber).map(Number);
    const col = { name: name.trim() || `col${i + 1}`, n: values.length, numeric: nums.length > 0 && nums.length >= 0.8 * Math.max(1, values.length) };
    const r6 = (x) => Math.round(x * 1e6) / 1e6;
    if (col.numeric) {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      col.min = r6(Math.min(...nums)); col.max = r6(Math.max(...nums)); col.mean = r6(mean);
      if (nums.length > 1) col.sd = r6(Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)));
    } else col.examples = [...new Set(values)].sort().slice(0, 8);
    return col;
  });
  return { n_rows: body.length, n_cols: header.length, columns };
}

export function preview(filename, raw, limit = 25) {
  const suffix = suffixOf(filename);
  if (ALLOWED[suffix] !== "table" || suffix === ".json") return { header: [], rows: [] };
  const rows = parse(raw);
  return rows.length ? { header: rows[0], rows: rows.slice(1, limit + 1) } : { header: [], rows: [] };
}
