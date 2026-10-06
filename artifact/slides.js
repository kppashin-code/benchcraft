// Slides from the record: the model lays them out, the page draws charts from the real files.
import * as B from "./lib/backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);
const INK = "021C45", INK2 = "3F5873", PAPER = "F2F6F3", LINE = "D3DFD8";
const SERIES = ["1D6F78", "1A56B8", "5AA9E6", "24664F"];

let DECK = null, CTX = null;

export function openSlides(project, exp, folders, ai) {
  CTX = { project, exp, folders, ai };
  const modal = document.getElementById("modal");
  modal.classList.remove("wide");
  const folder = exp && exp.folder_id ? folders.find((f) => f.id === exp.folder_id) : null;
  $("#modal-body").innerHTML = `<h2>Slides</h2>
    <p class="small muted">Laid out from what you wrote and the data attached to it. Charts are drawn from the files themselves.</p>
    <label>From</label>
    <select id="sl-scope">
      ${exp ? `<option value="exp">This entry: ${esc(exp.title)}</option>` : ""}
      ${folder ? `<option value="folder">This folder: ${esc(folder.name)}</option>` : ""}
      ${folders.filter((f) => !folder || f.id !== folder.id).map((f) => `<option value="f${f.id}">Folder: ${esc(f.name)}</option>`).join("")}
      <option value="project">Everything in ${esc(project.name)}</option>
    </select>
    ${ai ? `<div style="margin-top:14px"><button class="ai" id="sl-go">Make slides</button></div>`
      : `<p class="small muted" style="margin-top:14px">Turn on agentic help in the bookmarks bar to make slides.</p>`}
    <div class="err" id="sl-err"></div>
    <div id="sl-out"></div>`;
  if (!modal.open) modal.showModal();
  const go = $("#sl-go");
  if (go) go.onclick = async () => {
    const v = $("#sl-scope").value;
    const body = v === "exp" ? { experiment_id: exp.id } : v === "folder" ? { folder_id: folder.id } : v.startsWith("f") ? { folder_id: Number(v.slice(1)) } : {};
    go.disabled = true; go.textContent = "Laying them out…"; $("#sl-err").textContent = "";
    try { DECK = await B.api(`/projects/${project.id}/slides`, "POST", body); preview(); }
    catch (e) { $("#sl-err").textContent = e.message; }
    go.disabled = false; go.textContent = "Make them again";
  };
}

function preview() {
  $("#sl-out").innerHTML = `
    <h3 style="margin-top:20px">${esc(DECK.title)}</h3>
    <p class="small muted" style="margin-top:-6px">${esc(DECK.subtitle || "")}</p>
    <ol class="sl-list">${DECK.slides.map((s) => `<li><strong>${esc(s.title)}</strong>
      <ul class="ev pro">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      ${s.figure ? `<div class="tiny muted">Figure: ${esc(s.figure.caption)}</div>` : ""}
      ${s.chart ? `<div class="tiny muted">Chart: ${esc(s.chart.columns.join(", "))} from ${esc(s.chart.dataset)}</div>` : ""}</li>`).join("")}</ol>
    <div class="row" style="margin-top:14px;flex-wrap:wrap">
      <button id="sl-drive">Save to Google Drive</button>
      <button class="ghost" id="sl-dl">Download .pptx</button>
      <span class="tiny muted" id="sl-msg"></span>
    </div>`;
  $("#sl-drive").onclick = async () => {
    const msg = $("#sl-msg");
    msg.textContent = "Saving…";
    try {
      const pptx = await build();
      const out = await B.api("/slides/to_drive", "POST", { title: DECK.title, base64: await pptx.write({ outputType: "base64" }) });
      msg.innerHTML = out.url ? `Saved. <a href="${esc(out.url)}" target="_blank" rel="noopener">Open in Google Slides</a>` : "Saved to your Drive.";
    } catch (e) { msg.textContent = e.message; }
  };
  $("#sl-dl").onclick = async () => {
    const msg = $("#sl-msg");
    try {
      const d = await window.claude?.use("downloads");
      if (!d) { msg.textContent = "Downloads are not available in this view; save to Drive instead."; return; }
      const pptx = await build();
      await d.save({ filename: `${DECK.title.replace(/[^\w -]+/g, "").trim() || "slides"}.pptx`, data: await pptx.write({ outputType: "blob" }) });
    } catch (e) { msg.textContent = e.message || "Not saved."; }
  };
}

async function chartData(c) {
  const rows = await B.datasetRows(c.dataset_id);
  const header = rows[0] || [];
  const idx = c.columns.map((n) => header.indexOf(n)).filter((i) => i >= 0);
  const body = rows.slice(1);
  const nums = (i) => body.map((r) => Number(r[i])).filter(Number.isFinite);
  if (c.kind === "line") {
    const n = Math.min(200, body.length);
    return idx.map((i) => ({ name: header[i], labels: Array.from({ length: n }, (_, k) => String(k + 1)), values: body.slice(0, n).map((r) => Number(r[i]) || 0) }));
  }
  const means = idx.map((i) => { const v = nums(i); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  return [{ name: "mean", labels: idx.map((i) => header[i]), values: means.map((m) => Math.round(m * 1000) / 1000) }];
}

// Exported for the local check; the dialog calls it with the deck it just made.
export async function buildDeck(deck) { DECK = deck; return build(); }

async function build() {
  if (!window.PptxGenJS) throw new Error("The slide library did not load.");
  const pptx = new window.PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = DECK.title;
  const head = { fontFace: "Georgia", color: INK, bold: true };
  const body = { fontFace: "Arial", color: INK };

  const cover = pptx.addSlide();
  cover.background = { color: PAPER };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 6.9, w: 13.33, h: 0.6, fill: { color: INK } });
  cover.addText(DECK.title, { ...head, x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontSize: 40 });
  if (DECK.subtitle) cover.addText(DECK.subtitle, { ...body, color: INK2, x: 0.8, y: 3.8, w: 11.7, h: 0.6, fontSize: 18 });

  for (const s of DECK.slides) {
    const sl = pptx.addSlide();
    sl.background = { color: PAPER };
    sl.addText(s.title, { ...head, x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontSize: 28 });
    sl.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.25, w: 12.1, h: 0, line: { color: LINE, width: 1 } });
    const hasChart = !!s.chart || !!s.figure;
    if (s.bullets.length) {
      sl.addText(s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, paraSpaceAfter: 8 } })),
        { ...body, x: 0.6, y: 1.5, w: hasChart ? 5.8 : 12.1, h: 5.2, fontSize: 18, valign: "top" });
    }
    if (s.figure) {
      try {
        const blob = await (await fetch(s.figure.url)).blob();
        const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
        const dims = await new Promise((r) => { const im = new Image(); im.onload = () => r([im.naturalWidth, im.naturalHeight]); im.onerror = () => r([4, 3]); im.src = data; });
        const box = { w: 6.0, h: 4.9 }, ratio = dims[0] / dims[1];
        const w = Math.min(box.w, box.h * ratio), h = w / ratio;
        sl.addImage({ data, x: 6.7 + (box.w - w) / 2, y: 1.5 + (box.h - h) / 2, w, h });
        sl.addText(s.figure.source, { ...body, color: INK2, x: 6.7, y: 6.45, w: 6.0, h: 0.35, fontSize: 10 });
      } catch (e) {
        sl.addText(`Figure not placed: ${e.message}`, { ...body, color: INK2, x: 6.7, y: 1.5, w: 6.0, h: 0.5, fontSize: 12 });
      }
    } else if (hasChart) {
      try {
        const data = await chartData(s.chart);
        sl.addChart(s.chart.kind === "line" ? pptx.ChartType.line : pptx.ChartType.bar, data, {
          x: 6.7, y: 1.5, w: 6.0, h: 4.9, chartColors: SERIES, showLegend: data.length > 1, legendPos: "b",
          catAxisLabelColor: INK2, valAxisLabelColor: INK2, valGridLine: { color: LINE, size: 0.5 }, catAxisLabelFontFace: "Arial", valAxisLabelFontFace: "Arial",
        });
        sl.addText(`From ${s.chart.dataset}${s.chart.kind === "line" ? "" : ", column means"}`, { ...body, color: INK2, x: 6.7, y: 6.45, w: 6.0, h: 0.35, fontSize: 11 });
      } catch (e) {
        sl.addText(`Chart not drawn: ${e.message}`, { ...body, color: INK2, x: 6.7, y: 1.5, w: 6.0, h: 0.5, fontSize: 12 });
      }
    }
    if (s.notes) sl.addNotes(s.notes);
  }
  return pptx;
}
