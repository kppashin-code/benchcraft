// The freezer map and cell lines, opened from the bookmarks bar.
import * as B from "./lib/backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);
const pos = (r, c) => `${String.fromCharCode(65 + r)}${c + 1}`;
const TYPES = ["-80", "-20", "LN2", "4 °C", "room temp"];
const EVENTS = ["passaged", "thawed", "frozen", "split", "tested", "discarded", "note"];

let PID = null, EXP = null, ON_CHANGE = null, TAB = "freezer";
let STORE = [], LINES = [], REAGENTS = [], PICK = null, FIND = "", OPEN_LINE = null;

export async function openFreezer(projectId, exp, onChange) {
  PID = projectId; EXP = exp; ON_CHANGE = onChange;
  await load();
  const modal = document.getElementById("modal");
  modal.classList.add("wide");
  draw();
  if (!modal.open) modal.showModal();
}

async function load() {
  [STORE, LINES, REAGENTS] = await Promise.all([B.api(`/projects/${PID}/freezer`), B.api(`/projects/${PID}/lines`), B.api(`/projects/${PID}/reagents`)]);
}

async function act(fn, errSel = "#fz-err") {
  try { await fn(); await load(); draw(); if (ON_CHANGE) ON_CHANGE(); }
  catch (e) { const el = $(errSel); if (el) el.textContent = e.message; }
}

function draw() {
  $("#modal-body").innerHTML = `
    <h2>${TAB === "freezer" ? "Freezer" : "Cell lines"}</h2>
    <div class="chips" style="margin:6px 0 14px">
      <span class="chip fz-tab ${TAB === "freezer" ? "on" : ""}" data-ftab="freezer">Freezer</span>
      <span class="chip fz-tab ${TAB === "lines" ? "on" : ""}" data-ftab="lines">Cell lines</span>
    </div>
    ${TAB === "freezer" ? freezerView() : linesView()}
    <div class="err" id="fz-err"></div>`;
  wire();
}

// ---------- freezer ----------

function freezerView() {
  const hits = FIND ? STORE.flatMap((s) => s.boxes.flatMap((b) => b.vials.filter((v) => `${v.label} ${v.contents} ${v.notes}`.toLowerCase().includes(FIND.toLowerCase())).map((v) => v.id))) : [];
  return `
    <div class="row" style="margin-bottom:12px">
      <input id="fz-find" placeholder="Find a vial: line, passage, reagent" value="${esc(FIND)}" style="flex:1">
      ${FIND ? `<span class="tiny muted">${hits.length} found</span>` : ""}
    </div>
    ${STORE.length ? STORE.map((s) => `
      <section class="fz-unit">
        <div class="fz-unit-head"><strong>${esc(s.name)}</strong> <span class="pill">${esc(s.type)}</span>
          ${s.location ? `<span class="tiny muted">${esc(s.location)}</span>` : ""}
          <span style="flex:1"></span><button class="link" data-delstore="${s.id}">remove</button></div>
        <div class="fz-boxes">
          ${s.boxes.map((b) => boxView(b, hits)).join("")}
          <div class="fz-newbox">
            <input placeholder="New box label" data-boxlabel="${s.id}">
            <input placeholder="Where: shelf, rack" data-boxpos="${s.id}">
            <div class="row"><input type="number" min="1" max="12" value="9" data-boxrows="${s.id}" aria-label="Rows" style="width:64px">
              <span class="tiny muted">x</span><input type="number" min="1" max="12" value="9" data-boxcols="${s.id}" aria-label="Columns" style="width:64px">
              <button class="ghost sm" data-addbox="${s.id}">+ Box</button></div>
          </div>
        </div>
      </section>`).join("") : `<p class="small muted">Nothing mapped yet. Add the freezer, fridge or tank you use.</p>`}
    <div class="row" style="margin-top:14px;flex-wrap:wrap">
      <input id="fz-sname" placeholder="Freezer name, e.g. -80 A" style="flex:2;min-width:160px">
      <select id="fz-stype" style="flex:1;min-width:110px">${TYPES.map((t) => `<option>${t}</option>`).join("")}</select>
      <input id="fz-sloc" placeholder="Room or bench" style="flex:2;min-width:140px">
      <button class="ghost sm" id="fz-addstore">+ Storage</button>
    </div>
    ${PICK ? pickPanel() : ""}`;
}

function boxView(b, hits) {
  const at = new Map(b.vials.map((v) => [`${v.row},${v.col}`, v]));
  let cells = `<div></div>${Array.from({ length: b.cols }, (_, c) => `<div class="fz-ax">${c + 1}</div>`).join("")}`;
  for (let r = 0; r < b.rows; r++) {
    cells += `<div class="fz-ax">${String.fromCharCode(65 + r)}</div>`;
    for (let c = 0; c < b.cols; c++) {
      const v = at.get(`${r},${c}`);
      const sel = PICK && PICK.box === b.id && PICK.row === r && PICK.col === c;
      cells += v
        ? `<button class="fz-cell full${hits.includes(v.id) ? " hit" : ""}${sel ? " sel" : ""}" data-cell="${b.id},${r},${c}" title="${esc(pos(r, c))}: ${esc(v.label)}" aria-label="${esc(pos(r, c))}, ${esc(v.label)}"><span>${esc(v.label.slice(0, 4))}</span></button>`
        : `<button class="fz-cell${sel ? " sel" : ""}" data-cell="${b.id},${r},${c}" aria-label="${esc(pos(r, c))}, empty"></button>`;
    }
  }
  return `<div class="fz-box">
    <div class="fz-box-head"><strong>${esc(b.label)}</strong>${b.position ? ` <span class="tiny muted">${esc(b.position)}</span>` : ""}
      <span class="tiny muted" style="margin-left:auto">${b.vials.length}/${b.rows * b.cols}</span>
      <button class="link" data-delbox="${b.id}">remove</button></div>
    <div class="fz-grid" style="grid-template-columns: 18px repeat(${b.cols}, 1fr)">${cells}</div>
  </div>`;
}

function findVial(boxId, r, c) {
  for (const s of STORE) for (const b of s.boxes) if (b.id === boxId) return { box: b, storage: s, vial: b.vials.find((v) => v.row === r && v.col === c) || null };
  return {};
}

function pickPanel() {
  const { box, storage, vial } = findVial(PICK.box, PICK.row, PICK.col);
  if (!box) return "";
  const where = `${esc(storage.name)}, ${esc(box.label)}, ${pos(PICK.row, PICK.col)}`;
  if (vial) {
    const boxes = STORE.flatMap((s) => s.boxes.map((b) => ({ ...b, sname: s.name })));
    return `<div class="fz-panel">
      <div class="tiny muted">${where}</div>
      <h3 style="margin:6px 0 8px;text-transform:none;letter-spacing:0;font:600 18px var(--text);color:var(--ink)">${esc(vial.label)}</h3>
      <dl class="kv">
        ${vial.frozen_on ? `<dt>Frozen</dt><dd>${esc(vial.frozen_on)}${vial.frozen_by ? `, by ${esc(vial.frozen_by)}` : ""}</dd>` : ""}
        ${vial.contents && (vial.cell_line_id || vial.reagent_id) ? `<dt>Contents</dt><dd>${esc(vial.contents)}</dd>` : ""}
      </dl>
      <label>Notes</label><textarea id="fz-vnotes" rows="2">${esc(vial.notes)}</textarea>
      <div class="row" style="margin-top:10px;flex-wrap:wrap">
        <button id="fz-thaw">${EXP ? `Take out for "${esc(EXP.title)}"` : "Take out"}</button>
        <button class="ghost sm" id="fz-savev">Save notes</button>
        <span style="flex:1"></span>
        <select id="fz-movebox" style="width:auto">${boxes.map((b) => `<option value="${b.id}" ${b.id === box.id ? "selected" : ""}>${esc(b.sname)}, ${esc(b.label)}</option>`).join("")}</select>
        <input id="fz-movepos" placeholder="e.g. B4" style="width:80px">
        <button class="ghost sm" id="fz-move">Move</button>
      </div>
      <div class="err tiny" id="fz-perr"></div>
    </div>`;
  }
  return `<div class="fz-panel">
    <div class="tiny muted">${where}, empty</div>
    <div class="ctx-row" style="grid-template-columns:1fr 1fr;margin-top:8px">
      <div><label>Cell line</label><select id="fz-line"><option value="">none</option>${LINES.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
      <div><label>Or a reagent</label><select id="fz-reag"><option value="">none</option>${REAGENTS.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select></div>
    </div>
    <label>What is in it <span class="hint">Free text if it is neither, or extra detail.</span></label><input id="fz-contents">
    <div class="ctx-row" style="grid-template-columns:1fr 1fr 1fr">
      <div><label>Passage</label><input id="fz-passage"></div>
      <div><label>Frozen on</label><input id="fz-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div><label>By</label><input id="fz-by"></div>
    </div>
    <label>Notes</label><textarea id="fz-notes" rows="2"></textarea>
    <div style="margin-top:10px"><button id="fz-addvial">Put it here</button></div>
    <div class="err tiny" id="fz-perr"></div>
  </div>`;
}

// ---------- cell lines ----------

function linesView() {
  const byParent = {};
  LINES.forEach((l) => (byParent[l.parent_id || 0] ||= []).push(l));
  const tree = (pid, depth) => (byParent[pid] || []).map((l) => `
    <div class="ln" style="margin-left:${depth * 18}px">
      <button class="ln-head" data-line="${l.id}" aria-expanded="${OPEN_LINE === l.id}">
        <span class="tri">${OPEN_LINE === l.id ? "▾" : "▸"}</span><strong>${esc(l.name)}</strong>
        ${l.species ? `<span class="tiny muted">${esc(l.species)}</span>` : ""}
        <span class="pill">${l.vials_left} vial${l.vials_left === 1 ? "" : "s"}</span>
        ${l.myco_tested ? `<span class="tiny muted">myco ${esc(l.myco_tested)}</span>` : ""}
      </button>
      ${OPEN_LINE === l.id ? lineDetail(l) : ""}
    </div>${tree(l.id, depth + 1)}`).join("");
  return `${LINES.length ? tree(0, 0) : `<p class="small muted">No cell lines yet.</p>`}
    <h3 style="margin-top:22px">Add a line</h3>
    <div class="ctx-row" style="grid-template-columns:2fr 1fr 1fr 1fr">
      <input id="ln-name" placeholder="Name">
      <input id="ln-species" placeholder="Species, type">
      <input id="ln-source" placeholder="Source">
      <select id="ln-parent"><option value="">derived from</option>${LINES.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>
    </div>
    <button class="ghost sm" id="ln-add">+ Line</button>`;
}

function lineDetail(l) {
  return `<div class="ln-body">
    <dl class="kv">
      ${l.source ? `<dt>Source</dt><dd>${esc(l.source)}</dd>` : ""}
      ${l.parent_name ? `<dt>Derived from</dt><dd>${esc(l.parent_name)}</dd>` : ""}
      ${l.children.length ? `<dt>Gave rise to</dt><dd>${l.children.map((c) => esc(c.name)).join(", ")}</dd>` : ""}
    </dl>
    <div class="row" style="margin:10px 0;flex-wrap:wrap">
      <select id="ev-type" style="width:auto">${EVENTS.map((e) => `<option>${e}</option>`).join("")}</select>
      <input id="ev-passage" placeholder="P" style="width:64px">
      <input id="ev-date" type="date" value="${new Date().toISOString().slice(0, 10)}" style="width:auto">
      <input id="ev-note" placeholder="Note" style="flex:1;min-width:140px">
      <button class="ghost sm" id="ev-add" data-evline="${l.id}">Log${EXP ? " here" : ""}</button>
    </div>
    ${EXP ? `<div class="tiny muted" style="margin:-4px 0 8px">Logged against <strong>${esc(EXP.title)}</strong>.</div>` : ""}
    <div class="ln-events">${l.events.length ? l.events.map((e) => `<div class="ln-ev">
      <span class="ln-date">${esc(e.date || e.created_at.slice(0, 10))}</span>
      <span class="pill">${esc(e.type)}</span>${e.passage ? ` <span class="conf">P${esc(e.passage)}</span>` : ""}
      ${e.experiment_title ? ` <span class="tiny muted">${esc(e.experiment_title)}</span>` : ""}
      ${e.note ? ` <span class="small">${esc(e.note)}</span>` : ""}
      <button class="link" data-delev="${e.id}">remove</button></div>`).join("") : `<div class="small muted">No history yet.</div>`}</div>
  </div>`;
}

// ---------- wiring ----------

function wire() {
  const body = $("#modal-body");
  body.querySelectorAll("[data-ftab]").forEach((c) => c.onclick = () => { TAB = c.dataset.ftab; PICK = null; draw(); });
  if (TAB === "lines") {
    body.querySelectorAll("[data-line]").forEach((b) => b.onclick = () => { OPEN_LINE = OPEN_LINE === +b.dataset.line ? null : +b.dataset.line; draw(); });
    const add = $("#ln-add");
    if (add) add.onclick = () => act(() => B.api(`/projects/${PID}/lines`, "POST", { name: $("#ln-name").value, species: $("#ln-species").value, source: $("#ln-source").value, parent_id: $("#ln-parent").value || null }));
    const ev = $("#ev-add");
    if (ev) ev.onclick = () => act(() => B.api(`/lines/${ev.dataset.evline}/events`, "POST", { type: $("#ev-type").value, passage: $("#ev-passage").value, date: $("#ev-date").value, note: $("#ev-note").value, experiment_id: EXP ? EXP.id : null }));
    body.querySelectorAll("[data-delev]").forEach((b) => b.onclick = () => act(() => B.api(`/line_events/${b.dataset.delev}`, "DELETE")));
    return;
  }
  const find = $("#fz-find");
  find.oninput = () => { FIND = find.value; const p = find.selectionStart; draw(); const f = $("#fz-find"); f.focus(); f.setSelectionRange(p, p); };
  $("#fz-addstore").onclick = () => act(() => B.api(`/projects/${PID}/storages`, "POST", { name: $("#fz-sname").value, type: $("#fz-stype").value, location: $("#fz-sloc").value }));
  body.querySelectorAll("[data-delstore]").forEach((b) => b.onclick = () => act(() => B.api(`/storages/${b.dataset.delstore}`, "DELETE")));
  body.querySelectorAll("[data-addbox]").forEach((b) => b.onclick = () => {
    const id = b.dataset.addbox, v = (k) => body.querySelector(`[data-${k}="${id}"]`).value;
    act(() => B.api(`/storages/${id}/boxes`, "POST", { label: v("boxlabel"), position: v("boxpos"), rows: v("boxrows"), cols: v("boxcols") }));
  });
  body.querySelectorAll("[data-delbox]").forEach((b) => b.onclick = () => act(() => B.api(`/boxes/${b.dataset.delbox}`, "DELETE")));
  body.querySelectorAll("[data-cell]").forEach((c) => c.onclick = () => {
    const [box, row, col] = c.dataset.cell.split(",").map(Number);
    PICK = { box, row, col };
    draw();
    const panel = $(".fz-panel");
    if (panel) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  if (!PICK) return;
  const { vial } = findVial(PICK.box, PICK.row, PICK.col);
  const err = "#fz-perr";
  const addv = $("#fz-addvial");
  if (addv) addv.onclick = () => act(() => B.api(`/boxes/${PICK.box}/vials`, "POST", {
    row: PICK.row, col: PICK.col, cell_line_id: $("#fz-line").value || null, reagent_id: $("#fz-reag").value || null,
    contents: $("#fz-contents").value, passage: $("#fz-passage").value, frozen_on: $("#fz-date").value, frozen_by: $("#fz-by").value,
    notes: $("#fz-notes").value, experiment_id: EXP ? EXP.id : null,
  }), err);
  if (!vial) return;
  $("#fz-thaw").onclick = () => act(async () => { await B.api(`/vials/${vial.id}/thaw`, "POST", { experiment_id: EXP ? EXP.id : null }); PICK = null; }, err);
  $("#fz-savev").onclick = () => act(() => B.api(`/vials/${vial.id}`, "PUT", { notes: $("#fz-vnotes").value }), err);
  $("#fz-move").onclick = () => {
    const m = /^([A-La-l])(\d{1,2})$/.exec($("#fz-movepos").value.trim());
    if (!m) { $(err).textContent = "Give the new position like B4."; return; }
    const row = m[1].toUpperCase().charCodeAt(0) - 65, col = Number(m[2]) - 1;
    act(async () => { await B.api(`/vials/${vial.id}`, "PUT", { box_id: Number($("#fz-movebox").value), row, col }); PICK = { box: Number($("#fz-movebox").value), row, col }; }, err);
  };
}
