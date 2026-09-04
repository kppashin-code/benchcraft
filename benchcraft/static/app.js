const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ul = (items, cls) =>
  `<ul class="ev ${cls}">${(items || []).map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
const pad2 = (n) => String(n).padStart(2, "0");
const SPIN = `<span class="spin"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="6" opacity=".25"/>
  <path d="M8 2a6 6 0 0 1 6 6"/></svg></span>`;
const LOCK_OPEN = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round"><rect x="3" y="7.5" width="10" height="7" rx="1.6"/>
  <path d="M5.6 7.5V5a2.4 2.4 0 0 1 4.8-.3"/></svg>`;
const LOCK_SHUT = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round"><rect x="3" y="7.5" width="10" height="7" rx="1.6"/>
  <path d="M5.6 7.5V5a2.4 2.4 0 0 1 4.8 0v2.5"/></svg>`;
const TRASH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.5h6.8L12 4"/></svg>`;
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function withHighlights(text) {
  const hs = ((EXP && EXP.highlights) || []).map(h => h.body)
    .filter(Boolean).sort((a, b) => b.length - a.length);
  let out = esc(text);
  for (const h of hs) {
    out = out.replace(new RegExp(rx(esc(h)), "gi"), m => `<mark>${m}</mark>`);
  }
  return out;
}

let PROJECT = null, EXP = null, CTX = [], TAB = "ref";
let GLOSS = [], MATCHES = [], CONNS = [], FOLDERS = [], LOG = [];
let TSTATUS = { ready: false, missing: [] };
let ZSTATUS = { ready: false }, ZCOLLS = [], ZITEMS = [], ZALL = {};
let ZFILTER = { coll: "", engaged: true };
let UPLOADED = [];
let LIT = { query: "", results: [], used: "", dropped: [], preprints: false, reviews: false, ran: false };
let SUGG = { context_keys: [], context_values: {}, terms: [] };
let POLL = null;
let PREFS = {
  guided: localStorage.getItem("bc.guided") === "1",
  confidence: localStorage.getItem("bc.confidence") === "1",
};
function setPref(k, v) { PREFS[k] = v; localStorage.setItem("bc." + k, v ? "1" : "0"); }
let PEN = { open: false, colour: "#021C45", size: 2.2, erase: false, strokes: [] };
const INK_COLOURS = ["#021C45", "#1a56b8", "#8d3b32", "#2f6b3f"];

function strokeToPath(st) {
  const pts = st.points;
  if (!pts.length) return "";
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return `M${x} ${y} L${x + 0.1} ${y}`;
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0]} ${last[1]}`;
  return d;
}

function meanPressure(st) {
  const ps = st.points.map(p => p[2]).filter(v => v > 0);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;
}

function inkSvg(rec) {
  const strokes = typeof rec.strokes === "string" ? JSON.parse(rec.strokes) : rec.strokes;
  return `<svg viewBox="0 0 ${rec.width} ${rec.height}" xmlns="http://www.w3.org/2000/svg">
    ${strokes.map(st => `<path d="${strokeToPath(st)}" fill="none" stroke="${esc(st.colour)}"
      stroke-width="${(st.size * (0.4 + meanPressure(st) * 1.2)).toFixed(2)}"
      stroke-linecap="round" stroke-linejoin="round"/>`).join("")}
  </svg>`;
}

const STAGE_ORDER = ["notice", "commit", "challenge", "decide"];

const STAGE_ICON = {
  notice: `<svg viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round"><path d="M1 7h9"/><circle cx="14.5" cy="7" r="2.6"/></svg>`,
  commit: `<svg viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round"><path d="M1 7h11"/><path d="M15.5 2.2v9.6"/></svg>`,
  challenge: `<svg viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round"><path d="M1 7h5"/><path d="M6 7c4 0 4-5 8-5"/><path d="M6 7h8"/>
    <path d="M6 7c4 0 4 5 8 5"/></svg>`,
  decide: `<svg viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round"><path d="M1 7h5"/><path d="M6 7c4 0 4-5 8-5" opacity=".2"/>
    <path d="M6 7c4 0 4 5 8 5" opacity=".2"/><path d="M6 7h9" stroke-width="2.4"/>
    <circle cx="17" cy="7" r="2" fill="currentColor" stroke="none"/></svg>`,
};

async function api(path, method = "GET", body) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

function inCycle(exp) { return exp && exp.mode === "cycle"; }

function stageOf(exp) {
  if (!exp || !exp.commitments || !exp.commitments.length) return "notice";
  const c = exp.commitments[exp.commitments.length - 1];
  if (!c.challenges.length) return "commit";
  const ch = c.challenges[c.challenges.length - 1];
  return ch.responses.length ? "decide" : "challenge";
}

async function boot() {
  let projects = await api("/projects");
  if (!projects.length) {
    projects = [await api("/projects", "POST", { name: "Untitled project", description: "" })];
  }
  PROJECT = projects[0];
  TSTATUS = await api("/transcription/status");
  ZSTATUS = await api("/zotero/status");
  if (ZSTATUS.ready) {
    try {
      for (const it of await api("/zotero/items")) ZALL[it.key] = it;
    } catch (e) { ZSTATUS = { ready: false, detail: e.message }; }
  }
  await refreshList();
}

async function refreshList(selectId) {
  [LOG, FOLDERS, SUGG] = await Promise.all([
    api(`/projects/${PROJECT.id}/experiments`),
    api(`/projects/${PROJECT.id}/folders`),
    api(`/projects/${PROJECT.id}/suggestions`),
  ]);
  renderLog();
  const target = selectId || (EXP && EXP.id) || (LOG[0] && LOG[0].id);
  if (target) await openExperiment(target);
  else { renderNewExperiment(); renderRail(); renderStages(); }
}

function renderLog() {
  const groups = new Map([[null, []]]);
  FOLDERS.forEach(f => groups.set(f.id, []));
  LOG.forEach(e => groups.get(groups.has(e.folder_id) ? e.folder_id : null).push(e));

  const item = (e) => {
    const st = e.mode === "cycle" ? (e.stage || "notice") : "entry";
    return `<div class="log-item ${EXP && e.id === EXP.id ? "on" : ""}"
      draggable="true" data-id="${e.id}">
      <div class="t">${esc(e.title)}</div>
      <div class="log-meta">
        <span class="badge ${st}">${st}</span>
        <span class="date">${e.created_at.slice(0, 10)}</span>
        ${e.recording_count ? `<span class="date">${e.recording_count} voice</span>` : ""}
      </div>
      <button class="trash" data-delexp="${e.id}" title="Delete this entry">${TRASH}</button>
    </div>`;
  };

  let html = "";
  for (const f of FOLDERS) {
    const items = groups.get(f.id) || [];
    html += `<div class="drop-zone" data-folder="${f.id}">
      <div class="folder-head"><span>${esc(f.name)}</span>
        <button class="link" data-delf="${f.id}">remove</button></div>
      ${items.length ? items.map(item).join("")
        : `<div style="padding:10px 16px" class="tiny muted">Drag an entry here.</div>`}
    </div>`;
  }
  const loose = groups.get(null) || [];
  if (FOLDERS.length || loose.length) {
    html += `<div class="drop-zone" data-folder="">
      ${FOLDERS.length ? `<div class="folder-head"><span>Unfiled</span></div>` : ""}
      ${loose.length ? loose.map(item).join("")
        : `<div style="padding:10px 16px" class="tiny muted">Nothing unfiled.</div>`}
    </div>`;
  }
  $("#log").innerHTML = html || `<div style="padding:16px" class="small muted">Nothing yet.</div>`;

  $("#log").querySelectorAll(".log-item[data-id]").forEach(el =>
    el.onclick = (ev) => {
      if (ev.target.closest(".trash")) return;
      openExperiment(+el.dataset.id);
    });
  $("#log").querySelectorAll("[data-delexp]").forEach(el => el.onclick = async (ev) => {
    ev.stopPropagation();
    confirmDeleteExperiment(+el.dataset.delexp);
  });
  $("#log").querySelectorAll("[data-delf]").forEach(el => el.onclick = async (ev) => {
    ev.stopPropagation();
    await api(`/folders/${el.dataset.delf}`, "DELETE");
    await refreshList();
  });

  let dragId = null;
  $("#log").querySelectorAll(".log-item[data-id]").forEach(el => {
    el.ondragstart = (ev) => {
      dragId = +el.dataset.id;
      el.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", String(dragId));
    };
    el.ondragend = () => {
      dragId = null;
      el.classList.remove("dragging");
      $("#log").querySelectorAll(".drop-zone").forEach(z => z.classList.remove("over"));
    };
  });
  $("#log").querySelectorAll(".drop-zone").forEach(zone => {
    zone.ondragover = (ev) => { ev.preventDefault(); zone.classList.add("over"); };
    zone.ondragleave = () => zone.classList.remove("over");
    zone.ondrop = async (ev) => {
      ev.preventDefault();
      zone.classList.remove("over");
      const id = dragId || +ev.dataTransfer.getData("text/plain");
      if (!id) return;
      const fid = zone.dataset.folder ? +zone.dataset.folder : null;
      await api(`/experiments/${id}/folder`, "PUT", { folder_id: fid });
      LOG = await api(`/projects/${PROJECT.id}/experiments`);
      FOLDERS = await api(`/projects/${PROJECT.id}/folders`);
      renderLog();
    };
  });
}

function renderStages() {
  $("#now-title").textContent = EXP ? EXP.title : "";
  if (!inCycle(EXP)) {
    $("#stages").innerHTML = EXP
      ? `<button class="ghost sm" id="btn-cycle">Put this through the cycle</button>`
      : "";
    const b = $("#btn-cycle");
    if (b) b.onclick = async () => {
      EXP = await api(`/experiments/${EXP.id}/mode`, "PUT", { mode: "cycle" });
      render(); renderStages(); reloadLog();
    };
    return;
  }
  const at = STAGE_ORDER.indexOf(stageOf(EXP));
  $("#stages").innerHTML = STAGE_ORDER.map((s, i) => {
    const cls = i < at ? "done" : i === at ? "now" : "";
    return `<div class="stage ${cls}"><span class="num">${pad2(i + 1)}</span>${
      STAGE_ICON[s]}${s}</div>`;
  }).join(`<span class="stage-arrow">&rarr;</span>`);
}

async function openExperiment(id) {
  if (POLL) { clearInterval(POLL); POLL = null; }
  EXP = await api(`/experiments/${id}`);
  if ((EXP.recordings || []).some(r => r.transcript_state === "running")) pollTranscripts();
  document.querySelectorAll(".log-item[data-id]").forEach(el =>
    el.classList.toggle("on", +el.dataset.id === id));
  render();
  renderStages();
  refreshRailData();
}

async function refreshRailData() {
  [GLOSS, CONNS] = await Promise.all([
    api(`/projects/${PROJECT.id}/glossary`),
    api(`/projects/${PROJECT.id}/connectors`),
  ]);
  MATCHES = EXP ? await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`) : [];
  renderRail();
}

async function reloadLog() {
  LOG = await api(`/projects/${PROJECT.id}/experiments`);
  renderLog();
}

function render() {
  const c = EXP.commitments[EXP.commitments.length - 1] || null;
  const ch = c && c.challenges[c.challenges.length - 1] || null;
  const resp = ch && ch.responses[ch.responses.length - 1] || null;
  const ctx = Object.entries(EXP.context || {});

  const cycle = inCycle(EXP);
  const banner = !cycle ? ""
    : c
    ? `<div class="banner">${LOCK_OPEN}Your view is committed. Challenge unlocked.</div>`
    : `<div class="banner wait">${LOCK_SHUT}Write your own reading first. The challenge stays locked until you do.</div>`;

  $("#main").innerHTML = `
    ${banner}
    <div class="card">
      <h2>${esc(EXP.title)}</h2>
      ${EXP.question ? `<div class="qline"><b>Q:</b> ${esc(EXP.question)}</div>` : ""}
      ${ctx.length ? `<div class="ctx">${ctx.map(([k, v]) =>
        `<b>${esc(k)}:</b> ${esc(v)}`).join("&nbsp;&nbsp; ")}</div>` : ""}

      ${EXP.notes.some(n => n.source === "protocol") ? `
        <h3 style="margin-top:20px">Protocol</h3>
        <p class="tiny muted" style="margin-top:-6px">Annotate any line with what you actually
        did. Do not do 10 min, do 5.</p>
        <div style="margin-top:8px">
          ${EXP.notes.filter(n => n.source === "protocol").map(n => `
            <div class="step">
              <div class="ctx" style="margin:0">${withHighlights(n.body)}
                <button class="link" data-annot="${n.id}">annotate</button></div>
              ${(n.annotations || []).map(a => `<div class="stepnote">${esc(a.body)}
                <button class="link" data-delannot="${a.id}">remove</button></div>`).join("")}
            </div>`).join("")}
        </div>` : ""}
      <h3 style="margin-top:20px">Bench notes</h3>
      ${EXP.notes.filter(n => n.source !== "protocol").length
        ? EXP.notes.filter(n => n.source !== "protocol").map(n => `
            <div class="notes-row small">
              <div>${withHighlights(n.body)}
                <span class="muted tiny">${n.source === "voice" ? "dictated, " : ""}${n.created_at.slice(0, 10)}</span>
              </div>
              <button class="trash" data-delnote="${n.id}" title="Delete this note">${TRASH}</button>
            </div>`).join("")
        : `<div class="small muted">The things that decide whether it worked and never reach
           the spreadsheet. Consistency of a gel, a line that looked unhappy, beads sitting low.</div>`}
      <div class="row" style="margin-top:10px">
        <input id="note" placeholder="Add an observation" list="note-terms">
        <datalist id="note-terms">
          ${SUGG.terms.map(t => `<option value="${esc(t)}"></option>`).join("")}
        </datalist>
        <button class="ghost sm" id="btn-note">Add</button>
      </div>
    </div>
    ${renderReagentsUsed()}
    ${renderInk()}
    ${renderLinkedPapers()}
    ${renderConnectorOutput()}
    ${cycle
      ? `${c ? renderCommitment(c) : renderCommitForm()}
         ${c ? (ch ? renderChallenge(ch, c, resp) : renderChallengeGate()) : ""}
         ${c ? renderResolution(c, resp) : ""}`
      : renderCycleOffer()}
  `;
  wire(c, ch);
}

function renderCycleOffer() {
  return `<div class="card">
    <h3>This is a plain notebook entry</h3>
    <p class="small muted" style="margin-top:-4px">Record whatever you like here. Nothing is
    gated and no model sees any of it.</p>
    <p class="small" style="margin-top:10px">If you want this one argued with, put it through
    the cycle. You will write what you expected, what you saw, what you think it means and how
    confident you are. That gets locked, and only then does the challenge open. The order is the
    point: an interpretation written after reading the model's is not independent of it.</p>
    <div style="margin-top:14px"><button id="btn-cycle-inline">Put this through the cycle</button></div>
  </div>`;
}

function renderCommitment(c) {
  return `<div class="commitcard">
    <div class="hd">
      <span class="l">Your committed interpretation</span>
      <span class="p">preserved</span>
    </div>
    <div style="font-size:15.5px;line-height:1.6">${withHighlights(c.interpretation)}</div>
    ${c.confidence != null ? `<div class="meter">
      <div class="bar"><div class="fill" style="width:${c.confidence}%"></div></div>
      <div class="v">${c.confidence}% confidence</div>
    </div>` : ""}
    <dl style="margin:0">
      ${c.aim ? `<dt>Aim</dt><dd>${esc(c.aim)}</dd>` : ""}
      ${c.expected ? `<dt>Expected</dt><dd>${esc(c.expected)}</dd>` : ""}
      <dt>Observed</dt><dd>${withHighlights(c.observed)}</dd>
      ${c.disconfirming ? `<dt>Would change your mind</dt><dd>${esc(c.disconfirming)}</dd>` : ""}
      ${c.proposed_next ? `<dt>Next experiment you proposed</dt><dd>${esc(c.proposed_next)}</dd>` : ""}
    </dl>
    <div class="tiny muted" style="margin-top:16px">
      Locked ${c.locked_at.replace("T", " ").slice(0, 16)}. Your words, unedited.
    </div>
  </div>`;
}

function renderReagentsUsed() {
  const rs = EXP.reagents || [];
  if (!rs.length) return "";
  return `<div class="card">
    <h3>What went into this</h3>
    <p class="tiny muted" style="margin-top:-6px">Recorded so that when something goes wrong six
    weeks from now you can see exactly which lot you used.</p>
    ${rs.map(u => `<div class="small" style="margin-bottom:6px">
      <strong>${esc(u.name)}</strong>${u.lot ? `, lot ${esc(u.lot)}` : ""}${
      u.concentration ? `, ${esc(u.concentration)}` : ""}${
      u.amount ? `, used ${u.amount}${esc(u.unit || "")}` : ""}
      ${u.note ? `<span class="muted">, ${esc(u.note)}</span>` : ""}
      ${u.supplier ? `<div class="tiny muted">${esc(u.supplier)} ${esc(u.catalogue)}${
        u.location ? `, ${esc(u.location)}` : ""}</div>` : ""}
    </div>`).join("")}
  </div>`;
}

function renderInk() {
  const notes = EXP.ink || [];
  if (!PEN.open && !notes.length) return "";
  return `
    ${PEN.open ? `<div class="card penpad">
      <h3>Written by hand</h3>
      <p class="tiny muted" style="margin-top:-6px">Save as many as you like, they stack up below.
      For when you are gloved, or on an iPad.
      Pressure sensitive if you are using a stylus. Saved as strokes, so it stays sharp at any size.</p>
      <canvas id="pad"></canvas>
      <div class="pentools">
        ${INK_COLOURS.map(c => `<button class="swatch ${PEN.colour === c && !PEN.erase ? "on" : ""}"
          data-colour="${c}" style="background:${c}"></button>`).join("")}
        <button class="ghost sm ${PEN.erase ? "on" : ""}" id="pen-erase">${
          PEN.erase ? "Erasing" : "Erase"}</button>
        <button class="ghost sm" id="pen-undo">Undo</button>
        <button class="ghost sm" id="pen-clear">Clear</button>
        <span style="flex:1"></span>
        <button id="pen-save">Save note</button>
      </div>
      <div class="err tiny" id="pen-err"></div>
    </div>` : ""}
    ${notes.length ? `<div class="card">
      <h3>Handwritten notes</h3>
      ${notes.map(n => `<div class="inknote">
        <button class="link rm" data-rmink="${n.id}">remove</button>
        ${inkSvg(n)}
        <div class="tiny muted" style="padding:2px 4px 0">${n.created_at.slice(0, 10)}</div>
      </div>`).join("")}
    </div>` : ""}`;
}

function wirePad() {
  const cv = $("#pad");
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  cv.width = Math.round(rect.width * dpr);
  cv.height = Math.round(rect.height * dpr);
  const ctx = cv.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const redraw = () => {
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const st of PEN.strokes) {
      ctx.strokeStyle = st.colour;
      ctx.lineWidth = st.size * (0.4 + meanPressure(st) * 1.2);
      ctx.beginPath();
      const pts = st.points;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  };
  redraw();

  let drawing = false, cur = null;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [+(e.clientX - r.left).toFixed(1), +(e.clientY - r.top).toFixed(1),
            +(e.pressure > 0 ? e.pressure : 0.5).toFixed(2)];
  };

  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (PEN.erase) {
      const before = PEN.strokes.length;
      PEN.strokes = PEN.strokes.filter(st =>
        !st.points.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 14));
      if (PEN.strokes.length !== before) redraw();
      return;
    }
    drawing = true;
    cur = { colour: PEN.colour, size: PEN.size, points: [p] };
    PEN.strokes.push(cur);
  };
  cv.onpointermove = (e) => {
    if (!drawing || !cur) return;
    const p = pos(e);
    const last = cur.points[cur.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return;
    cur.points.push(p);
    ctx.strokeStyle = cur.colour;
    ctx.lineWidth = cur.size * (0.4 + p[2] * 1.2);
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  };
  const stop = () => { drawing = false; cur = null; };
  cv.onpointerup = stop;
  cv.onpointercancel = stop;
  cv.onpointerleave = stop;

  $("#main").querySelectorAll("[data-colour]").forEach(b => b.onclick = () => {
    PEN.colour = b.dataset.colour; PEN.erase = false; render();
  });
  $("#pen-erase").onclick = () => { PEN.erase = !PEN.erase; render(); };
  $("#pen-undo").onclick = () => { PEN.strokes.pop(); render(); };
  $("#pen-clear").onclick = () => { PEN.strokes = []; render(); };
  $("#pen-save").onclick = async () => {
    if (!PEN.strokes.length) { $("#pen-err").textContent = "Nothing written yet."; return; }
    try {
      EXP = await api(`/experiments/${EXP.id}/ink`, "POST",
        { strokes: PEN.strokes, width: Math.round(rect.width), height: Math.round(rect.height) });
      PEN.strokes = [];
      render();
      const err = $("#pen-err");
      if (err) {
        err.style.color = "var(--ok-ink)";
        err.textContent = `Saved. The pad is clear, keep writing if you want another.`;
      }
    } catch (e) { $("#pen-err").textContent = e.message; }
  };
}

function renderLinkedPapers() {
  const ps = EXP.papers || [];
  if (!ps.length) return "";
  return `<div class="card">
    <h3>Papers behind this experiment</h3>
    <p class="tiny muted" style="margin-top:-6px">Your own reading, from your Zotero library.
    Attached for your reference, not passed to the challenge.</p>
    ${ps.map(p => {
      const it = ZALL[p.zotero_key];
      return `<div class="paper">
        <div class="pt" data-openc="${esc(p.zotero_key)}">${esc(it ? it.title : p.zotero_key)}</div>
        ${it ? `<div class="pm">${esc(it.authors.join(", "))}${it.more_authors ? " et al." : ""}
          ${it.date ? `, ${esc(it.date)}` : ""}</div>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function renderConnectorOutput() {
  if (!EXP.connector_calls || !EXP.connector_calls.length) return "";
  return EXP.connector_calls.filter(cc => cc.ok).map(cc => `
    <div class="third-block">
      <div class="who">${esc(cc.connector_name)}, your tool, not Benchcraft's</div>
      <div class="tiny muted" style="margin-bottom:7px">You asked: ${esc(cc.request)}</div>
      <div class="verbatim">${esc(cc.response)}</div>
      <div class="tiny muted" style="margin-top:7px">
        Kept out of your commitment and out of the challenge. It is here to read, not to fold in.
      </div>
    </div>`).join("");
}

function renderCommitForm() {
  return `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <h3 style="margin:0">Your view, before anything answers</h3>
      <div class="row" style="gap:14px">
        <label class="tiny" style="margin:0;font-weight:400;white-space:nowrap">
          <input type="checkbox" id="opt-guided" ${PREFS.guided ? "checked" : ""}
            style="width:auto"> prompts</label>
        <label class="tiny" style="margin:0;font-weight:400;white-space:nowrap">
          <input type="checkbox" id="opt-conf" ${PREFS.confidence ? "checked" : ""}
            style="width:auto"> confidence</label>
      </div>
    </div>
    <p class="small muted" style="margin-top:6px">
      Write it however you write. Once you lock it, it cannot be edited, and only then does the
      challenge open.</p>

    ${PREFS.guided ? `
      <label>What did you expect?
        <span class="hint">Before you ran it. Say it even if it turned out wrong.</span></label>
      <textarea id="f-expected" rows="2"></textarea>
      <label>What did you actually observe?
        <span class="hint">The observation, not yet the reading of it.</span></label>
      <textarea id="f-observed" rows="3"></textarea>
      <label>What do you think happened?</label>
      <textarea id="f-interpretation" rows="3"></textarea>
      <label>What result would change your mind?
        <span class="hint">If you cannot name one, you are not holding a hypothesis yet.</span></label>
      <textarea id="f-disconfirming" rows="2"></textarea>
      <label>What should the next experiment be? <span class="hint">Optional.</span></label>
      <textarea id="f-next" rows="2"></textarea>`
    : `
      <label>Aim</label>
      <textarea id="f-aim" rows="2" placeholder="what this run was for"></textarea>
      <label>What happened</label>
      <textarea id="f-observed" rows="4" placeholder="what you saw"></textarea>
      <label>Conclusions</label>
      <textarea id="f-interpretation" rows="4" placeholder="what you make of it"></textarea>`}

    ${PREFS.confidence ? `
      <label>How confident are you? <span id="conflabel" class="conf">60</span>/100</label>
      <input type="range" id="f-confidence" min="0" max="100" value="60" style="padding:0">` : ""}

    <div style="margin-top:16px"><button id="btn-lock">Lock this and continue</button></div>
    <div class="err" id="lock-err"></div>
  </div>`;
}

function renderChallengeGate() {
  return `<div class="card">
    <div class="gate">
      Your view is on the record.<br>
      <button class="ai" id="btn-challenge" style="margin-top:13px">Now let it be challenged</button>
      <div class="small" style="margin-top:11px;max-width:52ch;margin-inline:auto">
        The model will generate its own explanations <em>without seeing your interpretation</em>,
        then compare. That is why the overlap means something.
      </div>
    </div>
    <div class="err" id="ch-err"></div>
  </div>`;
}

function renderChallenge(ch, c, resp) {
  const b = ch.blind, d = ch.divergence;
  return `
  <div class="sect-label">Challenges</div>
  ${b.explanations.map((e, i) => `
    <div class="hypo">
      <div class="n">Alternative hypothesis ${pad2(i + 1)} &middot; ${esc(e.kind)}</div>
      <div class="body"><strong>${esc(e.label)}.</strong> ${esc(e.statement)}</div>
      ${ul(e.supports, "pro")}${ul(e.contradicts, "con")}
      <div class="kill">Ruled out by: ${esc(e.would_rule_out)}</div>
    </div>`).join("")}

  <div class="hypo">
    <div class="n">What would distinguish these?</div>
    <div class="body">${esc(b.discriminating_experiment.description)}
      <span class="chip mini" style="margin-left:6px">${esc(b.discriminating_experiment.cost)}</span></div>
    <div class="small muted" style="margin-top:7px">${esc(b.discriminating_experiment.reads_out)}</div>
    <div class="sub">Confounders this design allows</div>
    ${(b.confounders || []).map(x =>
      `<div class="small" style="margin-bottom:5px"><strong>${esc(x.name)}</strong>: ${esc(x.why)}</div>`).join("")}
    <div class="sub">Controls missing from the record</div>
    ${ul(b.missing_controls, "con")}
    ${(b.record_is_silent_on || []).length ? `<div class="sub">Your record didn't say</div>
      ${ul(b.record_is_silent_on, "con")}` : ""}
  </div>

  ${d ? `<div class="ai-block" style="border-left-color:var(--navy);background:#f4f3ee">
    <div class="who" style="color:var(--navy)">Where you and it diverge</div>
    <div class="small"><strong>Your reading maps to:</strong> ${esc(d.matches)}</div>
    ${(d.they_saw_that_you_missed || []).length ? `
      <div class="sub" style="color:var(--navy);border-top-color:var(--rule)">You saw what it did not</div>
      ${ul(d.they_saw_that_you_missed, "pro")}` : ""}
    ${(d.you_raised_that_they_did_not_address || []).length ? `
      <div class="sub" style="color:var(--navy);border-top-color:var(--rule)">It raised what you did not address</div>
      ${ul(d.you_raised_that_they_did_not_address, "con")}` : ""}
    <div class="sub" style="color:var(--navy);border-top-color:var(--rule)">Strongest alternative you left unexamined</div>
    <div class="small">${esc(d.strongest_unexamined_alternative)}</div>
    <div class="small muted" style="margin-top:4px"><em>To put it down:</em> ${esc(d.how_to_dismiss_it)}</div>
    ${c.confidence != null && d.confidence_note ? `
      <div class="sub" style="color:var(--navy);border-top-color:var(--rule)">On your stated confidence of ${c.confidence}</div>
      <div class="small">${esc(d.confidence_note)}</div>` : ""}
  </div>` : ""}

  ${resp ? `<div class="locked">
      <div class="stamp">You ${esc(resp.stance)} your position${
        c.confidence != null && resp.confidence_after != null
          ? `. Confidence ${c.confidence} to ${resp.confidence_after}` : ""}</div>
      <div>${esc(resp.reasoning)}</div>
      ${resp.chosen_next ? `<div style="font-weight:600;font-size:12.5px;margin-top:9px">Next</div>
        <div>${esc(resp.chosen_next)}</div>` : ""}
    </div>
    <div class="card"><button class="ghost sm" id="btn-branch">Create the next experiment from this decision</button></div>`
  : `<div class="card">
      <h3>Your decision</h3>
      <p class="small muted" style="margin-top:-4px">Holding your position is a legitimate answer,
      and so is changing it. What is recorded is which one you did, and why.</p>
      <label>Where do you land?</label>
      <select id="r-stance">
        <option value="held">I hold my interpretation</option>
        <option value="revised">I revise it in part</option>
        <option value="overturned">I abandon it</option>
      </select>
      <label>Why? <span class="hint">Argue with it. If you are changing your mind, say what
        specifically moved you rather than that it sounded convincing.</span></label>
      <textarea id="r-reasoning" rows="3"></textarea>
      ${c.confidence != null ? `
        <label>Confidence now: <span id="r-conflabel" class="conf">${c.confidence}</span>/100</label>
        <input type="range" id="r-confidence" min="0" max="100" value="${c.confidence}" style="padding:0">` : ""}
      <label>What are you doing next, and why that?</label>
      <textarea id="r-next" rows="2"></textarea>
      <div style="margin-top:15px"><button id="btn-respond">Record decision</button></div>
      <div class="err" id="r-err"></div>
    </div>`}`;
}

async function confirmDeleteExperiment(id) {
  const p = await api(`/experiments/${id}/deletion_preview`);
  const rows = [
    [p.commitments, "locked commitment", "locked commitments"],
    [p.challenges, "challenge", "challenges"],
    [p.resolutions, "recorded outcome", "recorded outcomes"],
    [p.notes, "bench note", "bench notes"],
    [p.recordings, "voice memo", "voice memos"],
    [p.ink, "handwritten note", "handwritten notes"],
    [p.highlights, "highlight", "highlights"],
    [p.papers, "attached paper", "attached papers"],
  ].filter(r => r[0] > 0);

  $("#modal-body").innerHTML = `
    <h2 style="font-size:20px">Delete "${esc(p.title)}"?</h2>
    ${rows.length ? `<p class="small muted">This also deletes, permanently:</p>
      <ul class="ev con">${rows.map(r =>
        `<li>${r[0]} ${r[0] === 1 ? r[1] : r[2]}</li>`).join("")}</ul>`
      : `<p class="small muted">This entry has nothing recorded against it yet.</p>`}
    ${p.commitments ? `<p class="small" style="margin-top:12px;color:#8d3b32">
      A locked commitment cannot be recreated. It was your view at a moment that has passed,
      and deleting it removes that call from your calibration for good.</p>` : ""}
    ${p.children.length ? `<p class="small muted" style="margin-top:12px">
      ${p.children.length} later experiment${p.children.length > 1 ? "s" : ""} branched from this
      one and will be kept, but will lose the link back:
      ${p.children.map(t => esc(t)).join(", ")}.</p>` : ""}
    <div class="row" style="margin-top:18px">
      <button class="ghost" onclick="modal.close()">Keep it</button>
      <button id="do-delete" style="background:#8d3b32;border-color:#8d3b32">Delete permanently</button>
    </div>`;
  modal.showModal();
  $("#do-delete").onclick = async () => {
    await api(`/experiments/${id}`, "DELETE");
    modal.close();
    if (EXP && EXP.id === id) EXP = null;
    await refreshList();
  };
}

function renderResolution(c, resp) {
  const r = c.resolution;
  const settled = r && r.verdict !== "unresolved";
  if (settled) {
    const words = { held: "held up", partly: "partly held up", overturned: "was overturned" };
    return `<div class="locked">
      <div class="stamp">How it turned out</div>
      <div>Your interpretation ${esc(words[r.verdict] || r.verdict)}.${
        c.confidence != null ? ` You were ${c.confidence}/100 confident.` : ""}</div>
      ${r.notes ? `<div class="small muted" style="margin-top:6px">${esc(r.notes)}</div>` : ""}
      <div class="tiny muted" style="margin-top:8px">Recorded ${r.created_at.slice(0, 10)}.
        This is what the calibration score is computed from.</div>
    </div>`;
  }
  const days = (Date.now() - Date.parse(c.locked_at)) / 86400000;
  if (!resp && !r && days < 3) return "";
  return `<div class="card">
    <h3>How did it turn out?</h3>
    <p class="small muted" style="margin-top:-4px">Come back to this when you know, which may be
    weeks. This is what turns a claim into a record of whether it held.
    ${r ? "You marked this unresolved before." : ""}</p>
    <label>Verdict</label>
    <select id="v-verdict">
      <option value="held">My interpretation held</option>
      <option value="partly">It partly held</option>
      <option value="overturned">It was overturned</option>
      <option value="unresolved" ${r ? "selected" : ""}>Still don't know</option>
    </select>
    <label>What settled it? <span class="hint">Optional, but your future self will want it.</span></label>
    <textarea id="v-notes" rows="2">${r ? esc(r.notes) : ""}</textarea>
    <div style="margin-top:14px"><button id="btn-verdict">Record outcome</button></div>
    <div class="err" id="v-err"></div>
  </div>`;
}

function renderRail() {
  if (TAB === "ref") return renderRefRail();
  if (TAB === "voice") return renderVoiceRail();
  if (TAB === "papers") return renderPapersRail();
  return renderConnRail();
}

function renderRefRail() {
  const committed = EXP && EXP.commitments.length;
  const shown = MATCHES;
  $("#rail").innerHTML = `
    <div class="ref-intro">
      <div class="d">Definitions only. What a term denotes, never what your result means.
      That part stays yours.</div>
    </div>
    <div class="ref-state ${committed ? "" : "wait"}">
      ${committed
        ? "Your view is committed. Sources and AI analysis are now visible."
        : "Definitions are always available. AI interpretation stays locked until you commit."}
    </div>
    <div class="ref-body">
      <div class="ref-count">${shown.length} term${shown.length === 1 ? "" : "s"} recognised</div>
      <div class="chips">
        ${shown.map(g => `<span class="chip" data-term="${esc(g.term)}">${esc(g.term)}</span>`).join("")}
      </div>
      <div id="def-detail" style="margin-top:16px"></div>
      ${(EXP && EXP.highlights || []).length ? `
        <div style="margin-top:18px">
          <h3>Highlighted</h3>
          ${EXP.highlights.map(h => `<div class="hl-row">
            <mark style="flex:1">${esc(h.body)}</mark>
            <button class="link" data-unmark="${h.id}">remove</button>
          </div>`).join("")}
        </div>` : ""}
      <div class="tiny muted" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--rule)">
        Select any word in the middle pane to define it in the context of this experiment.
      </div>
      <button class="ghost sm" id="g-detect" style="margin-top:10px;width:100%">Scan this record for terms</button>
      <div class="err tiny" id="g-err"></div>
      <div style="margin-top:16px">
        <h3>Add your own</h3>
        <input id="g-term" placeholder="term" style="margin-bottom:5px">
        <textarea id="g-plain" rows="2" placeholder="plain-language definition"></textarea>
        <button class="ghost sm" id="g-add" style="margin-top:6px;width:100%">Add</button>
      </div>
      ${GLOSS.length > shown.length ? `<div class="tiny muted" style="margin-top:14px">
        ${GLOSS.length - shown.length} more in the project glossary, not mentioned here.</div>` : ""}
    </div>`;

  $("#rail").querySelectorAll("[data-term]").forEach(el => el.onclick = () => {
    $("#rail").querySelectorAll(".chip[data-term]").forEach(x => x.classList.remove("on"));
    el.classList.add("on");
    showDef(MATCHES.find(g => g.term === el.dataset.term)
         || GLOSS.find(g => g.term === el.dataset.term));
  });
  $("#rail").querySelectorAll("[data-unmark]").forEach(el => el.onclick = async () => {
    EXP = await api(`/highlights/${el.dataset.unmark}`, "DELETE");
    render(); renderRail();
  });
  $("#g-detect").onclick = async (e) => {
    const b = e.target;
    b.disabled = true; b.innerHTML = `${SPIN} reading`;
    try {
      GLOSS = await api(`/projects/${PROJECT.id}/glossary/detect`, "POST");
      MATCHES = await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`);
      renderRail();
    } catch (err) {
      b.disabled = false; b.textContent = "Scan this record for terms";
      $("#g-err").textContent = err.message;
    }
  };
  $("#g-add").onclick = async () => {
    const term = $("#g-term").value.trim(), plain = $("#g-plain").value.trim();
    if (!term || !plain) return;
    GLOSS = await api(`/projects/${PROJECT.id}/glossary`, "POST", { term, plain });
    MATCHES = await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`);
    renderRail();
  };
}

function showDef(g) {
  if (!g) return;
  $("#def-detail").innerHTML = `<div class="def">
    <div class="w">${esc(g.term)}<span class="src-tag">${esc(g.source)}</span></div>
    <div class="d">${esc(g.plain)}</div>
    <button class="link" style="margin-top:6px" data-del="${g.id}">remove</button>
  </div>`;
  const del = $("#def-detail").querySelector("[data-del]");
  if (del) del.onclick = async () => {
    GLOSS = await api(`/glossary/${del.dataset.del}`, "DELETE");
    MATCHES = MATCHES.filter(m => m.id !== +del.dataset.del);
    renderRail();
  };
}

let SELTERM = "";
document.addEventListener("mouseup", (e) => {
  if (e.target.closest && e.target.closest("#selpop")) return;
  const sel = window.getSelection();
  const text = (sel ? sel.toString() : "").trim();
  const node = sel && sel.anchorNode;
  const inMain = node && $("#main").contains(node.nodeType === 1 ? node : node.parentNode);
  const words = text.split(/\s+/).length;
  if (!text || !inMain || words > 5 || text.length < 2 || text.length > 80) {
    $("#selpop").style.display = "none";
    return;
  }
  SELTERM = text;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const pop = $("#selpop");
  pop.style.display = "block";
  pop.style.left = `${window.scrollX + r.left + r.width / 2 - pop.offsetWidth / 2}px`;
  pop.style.top = `${window.scrollY + r.top - pop.offsetHeight - 8}px`;
});

$("#selpop").querySelectorAll("[data-act]").forEach(btn => btn.onclick = async (ev) => {
  ev.stopPropagation();
  const pop = $("#selpop");
  const term = SELTERM;
  const act = btn.dataset.act;
  const label = btn.textContent;
  btn.textContent = "";
  try {
    if (act === "mark") {
      EXP = await api(`/experiments/${EXP.id}/highlights`, "POST", { body: term });
      render();
      if (TAB === "ref") renderRail();
    } else {
      const entry = await api(`/projects/${PROJECT.id}/glossary/define`, "POST",
        { term, experiment_id: EXP ? EXP.id : null });
      GLOSS = await api(`/projects/${PROJECT.id}/glossary`);
      MATCHES = await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`);
      TAB = "ref";
      document.querySelectorAll(".tab").forEach(x =>
        x.classList.toggle("on", x.dataset.tab === "ref"));
      renderRail();
      showDef(entry);
    }
  } catch (err) {
    if ($("#def-detail")) $("#def-detail").innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
  btn.textContent = label;
  pop.style.display = "none";
  window.getSelection().removeAllRanges();
});

function renderVoiceRail() {
  const recs = (EXP && EXP.recordings) || [];
  $("#rail").innerHTML = `<div class="ref-body">
    <h3>Voice memos</h3>
    <p class="tiny muted" style="margin-top:-5px">
      Transcribed <strong>verbatim</strong> and stored as your words. Benchcraft does not
      summarise a voice note, ever. A summary of a hunch is someone else's hunch.</p>
    ${TSTATUS.ready
      ? `<div class="tiny muted">Runs locally on this Mac: ${esc(TSTATUS.engine)}. Audio never leaves the machine.</div>`
      : `<div class="tiny" style="color:#8d3b32">Local transcription not set up:<br>${
          (TSTATUS.missing || []).map(m => esc(m)).join("<br>")}<br>
          You can still upload and type the transcript yourself.</div>`}
    <div class="drop" id="drop" style="margin-top:11px">
      Drop an MP3 here, or click to choose<br>
      <span class="tiny">mp3 &middot; m4a &middot; wav &middot; aac &middot; ogg &middot; flac</span>
    </div>
    <input type="file" id="file" accept="audio/*,video/mp4,video/quicktime" style="display:none">
    <div class="err tiny" id="v-err"></div>
    <div style="margin-top:13px">
      ${recs.length ? recs.map(r => `
        <div class="rec">
          <div class="row" style="align-items:flex-start">
            <div class="small" style="font-weight:500;flex:1">${esc(r.filename)}</div>
            <button class="trash" data-delrec="${r.id}" title="Delete this recording">${TRASH}</button>
          </div>
          <div class="tiny muted">${r.duration_s ? `${r.duration_s}s, ` : ""}${r.created_at.slice(0, 10)}</div>
          <audio controls preload="none" src="/api/recordings/${r.id}/audio"></audio>
          ${r.transcript
            ? `<div class="verbatim">${esc(r.transcript)}</div>
               <div class="tiny muted" style="margin-top:5px">${esc(r.transcript_engine)}</div>
               <div class="row" style="margin-top:7px">
                 <button class="ghost sm" data-note="${r.id}">Add to bench notes</button>
                 <button class="link" data-edit="${r.id}">edit</button>
               </div>`
            : r.transcript_state === "running"
            ? `<div class="tiny muted" style="margin-top:7px">
                 ${SPIN} transcribing on this Mac${
                   r.duration_s ? `, about ${Math.max(3, Math.round(r.duration_s / 2))}s` : ""}.
                 You can keep working.</div>`
            : `<div class="row" style="margin-top:7px">
                 <button class="ghost sm" data-tr="${r.id}" ${TSTATUS.ready ? "" : "disabled"}>${
                   r.transcript_state === "failed" ? "Try again" : "Transcribe"}</button>
                 <button class="link" data-edit="${r.id}">type it myself</button>
               </div>
               ${r.transcript_error ? `<div class="err tiny">${esc(r.transcript_error)}</div>` : ""}`}
        </div>`).join("")
        : `<div class="small muted">Nothing recorded for this experiment.</div>`}
    </div></div>`;

  const drop = $("#drop"), file = $("#file");
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
  };
  file.onchange = () => file.files[0] && upload(file.files[0]);

  $("#rail").querySelectorAll("[data-delrec]").forEach(el => el.onclick = async () => {
    EXP = await api(`/recordings/${el.dataset.delrec}`, "DELETE");
    render(); renderRail(); reloadLog();
  });
  $("#rail").querySelectorAll("[data-tr]").forEach(el => el.onclick = async () => {
    el.disabled = true;
    try {
      EXP = await api(`/recordings/${el.dataset.tr}/transcribe`, "POST");
      renderRail();
      pollTranscripts();
    } catch (err) {
      $("#v-err").textContent = err.message;
      el.disabled = false; el.textContent = "Transcribe";
    }
  });
  $("#rail").querySelectorAll("[data-note]").forEach(el => el.onclick = async () => {
    const rec = recs.find(r => r.id === +el.dataset.note);
    EXP = await api(`/experiments/${EXP.id}/notes`, "POST",
      { body: rec.transcript, source: "voice", recording_id: rec.id });
    render(); renderRail();
  });
  $("#rail").querySelectorAll("[data-edit]").forEach(el => el.onclick = () => {
    const rec = recs.find(r => r.id === +el.dataset.edit);
    $("#modal-body").innerHTML = `<h2>Transcript</h2>
      <p class="small muted">Your words. Correct anything the machine misheard.</p>
      <textarea id="t-edit" rows="10">${esc(rec.transcript)}</textarea>
      <div style="margin-top:12px"><button id="t-save">Save</button></div>`;
    modal.showModal();
    $("#t-save").onclick = async () => {
      EXP = await api(`/recordings/${rec.id}/transcript`, "PUT",
        { transcript: $("#t-edit").value });
      modal.close(); render(); renderRail();
    };
  });
}

function pollTranscripts() {
  if (POLL) return;
  POLL = setInterval(async () => {
    if (!EXP) return;
    const fresh = await api(`/experiments/${EXP.id}`);
    const running = (fresh.recordings || []).some(r => r.transcript_state === "running");
    EXP = fresh;
    if (TAB === "voice") renderRail();
    if (!running) {
      clearInterval(POLL);
      POLL = null;
      render();
      if (TAB === "voice") renderRail();
    }
  }, 2000);
}

async function upload(f) {
  const fd = new FormData();
  fd.append("file", f);
  $("#v-err").textContent = "";
  const r = await fetch(`/api/experiments/${EXP.id}/recordings`, { method: "POST", body: fd });
  if (!r.ok) { $("#v-err").textContent = (await r.json()).detail || "Upload failed"; return; }
  EXP = (await r.json()).experiment;
  render(); renderRail(); reloadLog();
}

async function loadPapers() {
  if (!ZSTATUS.ready) return renderRail();
  const q = new URLSearchParams();
  if (ZFILTER.coll) q.set("collection", ZFILTER.coll);
  if (ZFILTER.engaged) q.set("engaged_only", "true");
  [ZCOLLS, ZITEMS] = await Promise.all([
    ZCOLLS.length ? Promise.resolve(ZCOLLS) : api("/zotero/collections"),
    api(`/zotero/items?${q}`),
  ]);
  UPLOADED = await api(`/projects/${PROJECT.id}/papers/uploaded`);
  renderRail();
}

function uploadBlock() {
  return `
    <h3 style="margin-top:20px">Your own PDFs</h3>
    <p class="tiny muted" style="margin-top:-5px">No reference manager needed. Title, authors,
    year and DOI are read out of the file where the PDF carries them.</p>
    <div class="drop" id="pdf-drop">Drop a PDF here, or click to choose</div>
    <input type="file" id="pdf-file" accept="application/pdf" style="display:none">
    <div class="err tiny" id="pdf-err"></div>
    <div style="margin-top:10px">
      ${UPLOADED.map(it => `
        <div class="paper">
          <div class="row" style="align-items:flex-start">
            <div class="pt" data-open="${esc(it.key)}" style="flex:1">${esc(it.title)}</div>
            <button class="trash" data-delup="${it.key.split(":")[1]}">${TRASH}</button>
          </div>
          <div class="pm">${esc(it.authors.join(", "))}${it.date ? `, ${esc(it.date)}` : ""}</div>
          <div style="margin-top:6px">
            <span class="pill">pdf</span>
            ${it.has_digest ? `<span class="pill on">digest</span>` : ""}
            ${it.has_my_note ? `<span class="pill mine">my note</span>` : ""}
          </div>
        </div>`).join("") || `<div class="small muted">Nothing uploaded yet.</div>`}
    </div>`;
}

function wireUpload() {
  const drop = $("#pdf-drop"), file = $("#pdf-file");
  if (!drop) return;
  const send = async (f) => {
    $("#pdf-err").textContent = "";
    const fd = new FormData();
    fd.append("file", f);
    drop.textContent = "reading";
    const r = await fetch(`/api/projects/${PROJECT.id}/papers/upload`, { method: "POST", body: fd });
    drop.textContent = "Drop a PDF here, or click to choose";
    if (!r.ok) { $("#pdf-err").textContent = (await r.json()).detail || "Upload failed"; return; }
    UPLOADED = await api(`/projects/${PROJECT.id}/papers/uploaded`);
    renderRail();
  };
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]);
  };
  file.onchange = () => file.files[0] && send(file.files[0]);
  $("#rail").querySelectorAll("[data-delup]").forEach(el => el.onclick = async () => {
    UPLOADED = await api(`/uploaded_papers/${el.dataset.delup}`, "DELETE");
    renderRail();
  });
  $("#rail").querySelectorAll("[data-open]").forEach(el =>
    el.onclick = () => openPaper(el.dataset.open));
}

function renderPapersRail() {
  if (!ZSTATUS.ready) {
    $("#rail").innerHTML = `<div class="ref-body">
      ${uploadBlock()}
      <div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--rule)">
        <h3>Zotero</h3>
        <div class="tiny muted">${esc(ZSTATUS.detail || "No Zotero library found.")}
        If you use Zotero, Benchcraft reads it straight off disk. Nothing is uploaded and no
        account is connected.</div>
      </div></div>`;
    wireUpload();
    return;
  }
  const linked = new Set((EXP && EXP.papers || []).map(p => p.zotero_key));
  $("#rail").innerHTML = `<div class="ref-body">
    <h3>From your library</h3>
    <p class="tiny muted" style="margin-top:-5px">Your own reading, available before you commit.
    These are the papers that got you here, so they belong to your judgement, not the AI's.</p>
    <select id="z-coll" style="margin-bottom:6px">
      <option value="">All ${ZSTATUS.items} items</option>
      ${ZCOLLS.map(c => `<option value="${esc(c.key)}" ${ZFILTER.coll === c.key ? "selected" : ""}>
        ${esc(c.name)} (${c.n})</option>`).join("")}
    </select>
    <label style="margin:0 0 8px;font-weight:400;font-size:12px">
      <input type="checkbox" id="z-eng" ${ZFILTER.engaged ? "checked" : ""} style="width:auto">
      only what I've tagged or annotated</label>
    <div>
      ${ZITEMS.length ? ZITEMS.map(it => `
        <div class="paper">
          <div class="pt" data-open="${esc(it.key)}">${esc(it.title)}</div>
          <div class="pm">${esc(it.authors.join(", "))}${it.more_authors ? " et al." : ""}
            ${it.date ? `, ${esc(it.date)}` : ""}${it.journal ? `, ${esc(it.journal)}` : ""}</div>
          <div style="margin-top:6px">
            ${it.has_pdf ? `<span class="pill">pdf</span>` : ""}
            ${it.tags.length ? `<span class="pill">${it.tags.length} tags</span>` : ""}
            ${it.has_digest ? `<span class="pill on">digest</span>` : ""}
            ${it.has_my_note ? `<span class="pill mine">my note</span>` : ""}
            ${EXP ? `<button class="link" data-link="${esc(it.key)}">${
              linked.has(it.key) ? "unlink" : "attach"}</button>` : ""}
          </div>
        </div>`).join("") : `<div class="small muted">Nothing matches.</div>`}
    </div>
    <div class="err tiny" id="z-err"></div>
    ${uploadBlock()}

    <div style="margin-top:22px;padding-top:16px;border-top:1px solid var(--rule)">
      <h3>From the field</h3>
      <p class="tiny muted" style="margin-top:-5px">How other people have handled this. Europe PMC,
      peer reviewed by default. Your own query, so nothing about your experiment is sent unless
      you put it there.</p>
      <textarea id="lit-q" rows="2" placeholder="search terms">${esc(LIT.query)}</textarea>
      <label style="margin:7px 0 3px;font-weight:400;font-size:12px">
        <input type="checkbox" id="lit-pp" ${LIT.preprints ? "checked" : ""} style="width:auto">
        include preprints</label>
      <label style="margin:0 0 7px;font-weight:400;font-size:12px">
        <input type="checkbox" id="lit-rev" ${LIT.reviews ? "checked" : ""} style="width:auto">
        reviews only</label>
      <div class="row">
        <button class="ghost sm" id="lit-suggest" style="flex:1">Suggest from record</button>
        <button class="sm" id="lit-go" style="flex:1">Search</button>
      </div>
      <div class="err tiny" id="lit-err"></div>
      ${LIT.dropped.length ? `<div class="tiny muted" style="margin-top:8px">
        Nothing matched all your terms, so it dropped
        ${LIT.dropped.map(d => `<strong>${esc(d)}</strong>`).join(", ")} and searched
        <code>${esc(LIT.used)}</code>.</div>` : ""}
      <div style="margin-top:10px">
        ${LIT.results.length ? LIT.results.map(r => `
          <div class="paper">
            <a class="pt" href="${esc(r.url)}" target="_blank" rel="noopener"
               style="text-decoration:none;display:block">${esc(r.title)}</a>
            <div class="pm">${esc(r.authors.join(", "))}${r.more_authors ? " et al." : ""}
              ${r.journal ? `, ${esc(r.journal)}` : ""}${r.year ? `, ${esc(r.year)}` : ""}</div>
            <div style="margin-top:6px">
              <span class="pill ${r.kind === "preprint" ? "" : "on"}">${esc(r.kind)}</span>
              ${r.cited_by ? `<span class="pill">${r.cited_by} cites</span>` : ""}
              ${r.open_access ? `<span class="pill">open</span>` : ""}
              ${r.in_my_library ? `<span class="pill mine">in my library</span>` : ""}
            </div>
          </div>`).join("")
          : LIT.ran ? `<div class="small muted">Nothing found. Try fewer terms.</div>` : ""}
      </div>
    </div></div>`;

  wireUpload();
  $("#z-coll").onchange = (e) => { ZFILTER.coll = e.target.value; loadPapers(); };
  $("#z-eng").onchange = (e) => { ZFILTER.engaged = e.target.checked; loadPapers(); };
  $("#rail").querySelectorAll("[data-open]").forEach(el =>
    el.onclick = () => openPaper(el.dataset.open));
  $("#rail").querySelectorAll("[data-link]").forEach(el => el.onclick = async () => {
    const k = el.dataset.link;
    EXP = linked.has(k)
      ? await api(`/experiments/${EXP.id}/papers/${k}`, "DELETE")
      : await api(`/experiments/${EXP.id}/papers`, "POST", { zotero_key: k });
    render(); renderRail();
  });

  const q = $("#lit-q");
  q.oninput = () => LIT.query = q.value;
  $("#lit-pp").onchange = (e) => LIT.preprints = e.target.checked;
  $("#lit-rev").onchange = (e) => LIT.reviews = e.target.checked;
  $("#lit-suggest").onclick = async () => {
    if (!EXP) return;
    const out = await api(`/experiments/${EXP.id}/literature/suggest`);
    LIT.query = out.query;
    q.value = out.query;
  };
  $("#lit-go").onclick = async (e) => {
    const b = e.target;
    if (!LIT.query.trim()) { $("#lit-err").textContent = "Type something to search for."; return; }
    b.disabled = true; b.innerHTML = SPIN;
    try {
      const out = await api("/literature/search", "POST", {
        query: LIT.query, include_preprints: LIT.preprints, reviews_only: LIT.reviews,
      });
      LIT.results = out.results;
      LIT.used = out.query_used;
      LIT.dropped = out.dropped;
      LIT.ran = true;
      renderRail();
    } catch (err) {
      b.disabled = false; b.textContent = "Search";
      $("#lit-err").textContent = err.message;
    }
  };
}

async function openPaper(key) {
  $("#modal-body").innerHTML = `<p class="small muted">${SPIN} loading</p>`;
  modal.showModal();
  drawPaper(await api(`/papers/${key}`));
}

function drawPaper(p) {
  const it = p.item, d = p.digest;
  $("#modal-body").innerHTML = `
    <h2 style="font-size:19px">${esc(it.title)}</h2>
    <div class="small muted">${esc(it.authors.join(", "))}${it.more_authors ? " et al." : ""}
      ${it.date ? `, ${esc(it.date)}` : ""}${it.journal ? `, ${esc(it.journal)}` : ""}</div>
    ${it.source === "upload" ? `<div class="tiny"><a href="/api/papers/${esc(it.key)}/pdf"
      target="_blank" rel="noopener">open the pdf</a></div>` : ""}
    ${it.doi ? `<div class="tiny"><a href="https://doi.org/${esc(it.doi)}" target="_blank"
      rel="noopener">doi.org/${esc(it.doi)}</a></div>` : ""}
    ${it.tags.length ? `<div class="chips">${it.tags.map(t =>
      `<span class="chip mini">${esc(t)}</span>`).join("")}</div>` : ""}

    <h3 style="margin-top:20px">My note</h3>
    <p class="tiny muted" style="margin-top:-6px">Yours. Written after you read it, not instead
    of reading it.</p>
    <textarea id="p-note" rows="4" placeholder="What did you take from this?">${esc(p.my_note)}</textarea>
    <button class="ghost sm" id="p-save" style="margin-top:6px">Save note</button>
    <span class="tiny muted" id="p-saved" style="margin-left:8px"></span>

    <h3 style="margin-top:22px">What this paper did</h3>
    ${d ? `
      <div class="ai-block">
        <div class="who">Digest, ${esc(d.source)}</div>
        <div class="small">${esc(d.main_claim)}</div>
        ${d.experiments.length ? `<div class="sub">Experiments</div>${ul(d.experiments, "pro")}` : ""}
        ${d.methods.length ? `<div class="sub">Methods</div>${ul(d.methods, "pro")}` : ""}
        ${d.limitations.length ? `<div class="sub">Limitations the authors state</div>
          ${ul(d.limitations, "con")}` : ""}
        <div class="tiny muted" style="margin-top:12px">Describes what the authors did and claim.
        It will not tell you what this means for your experiment. That reading is yours.</div>
      </div>
      <button class="ghost sm" id="p-redigest">Regenerate</button>`
    : `<div class="gate">
        <button class="ai" id="p-digest">Digest this paper</button>
        <div class="tiny" style="margin-top:10px;max-width:46ch;margin-inline:auto">
          Main claim, the experiments actually run, and methods with the numbers.
          ${it.has_pdf ? "Reads the stored PDF." : "No PDF stored, so it will work from the abstract only."}
        </div>
      </div>`}
    ${it.abstract ? `<h3 style="margin-top:20px">Abstract</h3>
      <div class="small muted">${esc(it.abstract)}</div>` : ""}
    <div class="err" id="p-err"></div>`;

  $("#p-save").onclick = async () => {
    const out = await api(`/papers/${it.key}/note`, "PUT", { body: $("#p-note").value });
    $("#p-saved").textContent = "saved";
    ZITEMS = ZITEMS.map(x => x.key === it.key ? { ...x, has_my_note: !!out.my_note } : x);
  };
  const dig = $("#p-digest") || $("#p-redigest");
  if (dig) dig.onclick = async () => {
    dig.disabled = true;
    dig.innerHTML = `${SPIN} reading`;
    try {
      const out = await api(`/papers/${it.key}/digest`, "POST");
      ZITEMS = ZITEMS.map(x => x.key === it.key ? { ...x, has_digest: true } : x);
      drawPaper(out); renderRail();
    } catch (e) {
      dig.disabled = false; dig.textContent = "Digest this paper";
      $("#p-err").textContent = e.message;
    }
  };
}

function renderConnRail() {
  $("#rail").innerHTML = `<div class="ref-body">
    <h3>Your tools</h3>
    <p class="tiny muted" style="margin-top:-5px">Accounts and agents you bring. Their output is
    shown as a third voice, attributed and separate, never merged into your commitment and never
    fed to the challenger.</p>
    ${CONNS.length ? CONNS.map(c => `
      <div class="conn">
        <div class="small" style="font-weight:600">${esc(c.name)}</div>
        <div class="tiny muted">${esc(c.endpoint || "no endpoint set")}${c.key_env ? `, ${esc(c.key_env)}` : ""}</div>
        ${c.note ? `<div class="tiny muted" style="margin-top:4px">${esc(c.note)}</div>` : ""}
        <div class="row" style="margin-top:7px">
          ${c.enabled && c.endpoint
            ? `<button class="ghost sm" data-ask="${c.id}">Ask it</button>`
            : `<span class="tiny muted">off</span>`}
          <button class="link" data-rm="${c.id}">remove</button>
        </div>
      </div>`).join("") : `<div class="small muted">None connected.</div>`}
    <div class="err tiny" id="c-err"></div>
    <div style="margin-top:14px">
      <h3>Connect one</h3>
      <input id="c-name" placeholder="name" style="margin-bottom:5px">
      <input id="c-endpoint" placeholder="https://... endpoint" style="margin-bottom:5px">
      <input id="c-key" placeholder="env var holding the key (optional)" style="margin-bottom:5px">
      <label style="margin:6px 0 4px"><input type="checkbox" id="c-on" style="width:auto"> enabled</label>
      <button class="ghost sm" id="c-add" style="width:100%">Add</button>
    </div>
    <div style="margin-top:14px"><h3>Suggested</h3>
      <div id="c-sugg" class="tiny muted"></div></div></div>`;

  api("/connectors/suggested").then(s => {
    $("#c-sugg").innerHTML = s.map((x, i) => `
      <div style="margin-bottom:8px">
        <button class="link" data-pre="${i}">${esc(x.name)}</button>
        <div>${esc(x.note)}</div>
      </div>`).join("");
    $("#c-sugg").querySelectorAll("[data-pre]").forEach(el => el.onclick = () => {
      const x = s[+el.dataset.pre];
      $("#c-name").value = x.name; $("#c-key").value = x.key_env;
    });
  });

  $("#c-add").onclick = async () => {
    const name = $("#c-name").value.trim();
    if (!name) return;
    CONNS = await api(`/projects/${PROJECT.id}/connectors`, "POST", {
      name, endpoint: $("#c-endpoint").value.trim(), key_env: $("#c-key").value.trim(),
      enabled: $("#c-on").checked,
    });
    renderRail();
  };
  $("#rail").querySelectorAll("[data-rm]").forEach(el => el.onclick = async () => {
    CONNS = await api(`/connectors/${el.dataset.rm}`, "DELETE");
    renderRail();
  });
  $("#rail").querySelectorAll("[data-ask]").forEach(el => el.onclick = async () => {
    const q = prompt("What do you want to ask it?");
    if (!q) return;
    el.disabled = true;
    try {
      EXP = await api(`/connectors/${el.dataset.ask}/call`, "POST",
        { experiment_id: EXP.id, question: q });
      render(); renderRail();
    } catch (err) { $("#c-err").textContent = err.message; el.disabled = false; }
  });
}

function wire(c, ch) {
  wirePad();
  $("#main").querySelectorAll("[data-rmink]").forEach(el => el.onclick = async () => {
    EXP = await api(`/ink/${el.dataset.rmink}`, "DELETE");
    render();
  });
  $("#main").querySelectorAll("[data-openc]").forEach(el =>
    el.onclick = () => openPaper(el.dataset.openc));

  const og = $("#opt-guided");
  if (og) og.onchange = (e) => { setPref("guided", e.target.checked); render(); };
  const oc = $("#opt-conf");
  if (oc) oc.onchange = (e) => { setPref("confidence", e.target.checked); render(); };

  const conf = $("#f-confidence");
  if (conf) conf.oninput = () => $("#conflabel").textContent = conf.value;
  const rconf = $("#r-confidence");
  if (rconf) rconf.oninput = () => $("#r-conflabel").textContent = rconf.value;

  $("#main").querySelectorAll("[data-annot]").forEach(el => el.onclick = async () => {
    const body = prompt("What did you actually do on this step?");
    if (!body) return;
    EXP = await api(`/notes/${el.dataset.annot}/annotations`, "POST", { body });
    render();
  });
  $("#main").querySelectorAll("[data-delannot]").forEach(el => el.onclick = async () => {
    EXP = await api(`/annotations/${el.dataset.delannot}`, "DELETE");
    render();
  });
  $("#main").querySelectorAll("[data-delnote]").forEach(el => el.onclick = async () => {
    EXP = await api(`/notes/${el.dataset.delnote}`, "DELETE");
    render(); refreshRailData();
  });

  const cyc = $("#btn-cycle-inline");
  if (cyc) cyc.onclick = async () => {
    EXP = await api(`/experiments/${EXP.id}/mode`, "PUT", { mode: "cycle" });
    render(); renderStages(); reloadLog();
  };

  const note = $("#btn-note");
  if (note) note.onclick = async () => {
    const body = $("#note").value.trim();
    if (!body) return;
    EXP = await api(`/experiments/${EXP.id}/notes`, "POST", { body });
    render(); refreshRailData();
  };

  const lock = $("#btn-lock");
  if (lock) lock.onclick = async () => {
    try {
      lock.disabled = true;
      const val = (id) => { const el = $(id); return el ? el.value.trim() : ""; };
      const out = await api(`/experiments/${EXP.id}/commitments`, "POST", {
        aim: val("#f-aim"),
        expected: val("#f-expected"),
        observed: val("#f-observed"),
        interpretation: val("#f-interpretation"),
        confidence: $("#f-confidence") ? +$("#f-confidence").value : null,
        disconfirming: val("#f-disconfirming"),
        proposed_next: val("#f-next"),
      });
      EXP = out.experiment;
      render(); renderStages(); renderRail(); reloadLog();
    } catch (e) { lock.disabled = false; $("#lock-err").textContent = e.message; }
  };

  const btnCh = $("#btn-challenge");
  if (btnCh) btnCh.onclick = async () => {
    btnCh.disabled = true;
    btnCh.innerHTML = `${SPIN} thinking against you`;
    try {
      EXP = await api(`/commitments/${c.id}/challenge`, "POST");
      render(); renderStages(); reloadLog();
    } catch (e) {
      btnCh.disabled = false; btnCh.textContent = "Now let it be challenged";
      $("#ch-err").textContent = e.message;
    }
  };

  const btnR = $("#btn-respond");
  if (btnR) btnR.onclick = async () => {
    try {
      btnR.disabled = true;
      EXP = await api(`/challenges/${ch.id}/response`, "POST", {
        stance: $("#r-stance").value,
        reasoning: $("#r-reasoning").value.trim(),
        confidence_after: $("#r-confidence") ? +$("#r-confidence").value : null,
        chosen_next: $("#r-next").value.trim(),
      });
      render(); renderStages(); reloadLog();
    } catch (e) { btnR.disabled = false; $("#r-err").textContent = e.message; }
  };

  const verdict = $("#btn-verdict");
  if (verdict) verdict.onclick = async () => {
    try {
      verdict.disabled = true;
      EXP = await api(`/commitments/${c.id}/resolution`, "POST", {
        verdict: $("#v-verdict").value,
        notes: $("#v-notes").value.trim(),
      });
      render(); reloadLog();
    } catch (e) { verdict.disabled = false; $("#v-err").textContent = e.message; }
  };

  const branch = $("#btn-branch");
  if (branch) branch.onclick = () => renderNewExperiment(EXP.id);
}

function renderNewExperiment(parentId) {
  CTX = [["cell line", ""], ["passage", ""], ["differentiation day", ""]];
  const valueListId = (i) => `vals-${i}`;
  const rows = () => CTX.map((_, i) => {
    const vals = SUGG.context_values[CTX[i][0]] || [];
    return `<div class="ctx-row">
      <input placeholder="variable" value="${esc(CTX[i][0])}" data-k="${i}" list="ctx-keys">
      <input placeholder="value" value="${esc(CTX[i][1])}" data-v="${i}"
        list="${valueListId(i)}" ${vals.length ? `title="you have used: ${esc(vals.slice(0,4).join(", "))}"` : ""}>
      <datalist id="${valueListId(i)}">
        ${vals.map(v => `<option value="${esc(v)}"></option>`).join("")}
      </datalist>
      <button class="ghost sm" data-x="${i}">&times;</button>
    </div>`;
  }).join("");

  $("#main").innerHTML = `<div class="card">
    <h2>${parentId ? "Next experiment" : "New experiment"}</h2>
    ${parentId ? `<div class="small muted">Linked in the decision graph as the step you chose
      after the previous one.</div>` : ""}
    <label>Title</label><input id="n-title">
    <label>What question is this asking?
      <span class="hint">The question, not the technique.</span></label>
    <textarea id="n-question" rows="2"></textarea>
    <label style="margin-top:16px">
      <input type="checkbox" id="n-cycle" style="width:auto"> Put this through the cycle
      <span class="hint">Leave off for a plain notebook entry. You can turn it on later.</span>
    </label>
    ${FOLDERS.length ? `<label>Folder</label>
      <select id="n-folder"><option value="">Unfiled</option>
        ${FOLDERS.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}
      </select>` : ""}
    <label>Experimental context
      <span class="hint">Every variable here is one the challenge can reason about as a
      confounder, so record the boring ones: batch, lot, passage.</span></label>
    <datalist id="ctx-keys">
      ${SUGG.context_keys.map(k => `<option value="${esc(k)}"></option>`).join("")}
    </datalist>
    <div id="ctx">${rows()}</div>
    ${SUGG.context_keys.length ? `<div class="tiny muted" style="margin-top:4px">
      Variables and values you have used before will complete as you type.</div>` : ""}
    <button class="ghost sm" id="ctx-add">+ variable</button>
    <div style="margin-top:16px"><button id="n-save">Create</button></div>
    <div class="err" id="n-err"></div>
  </div>`;

  const bind = () => {
    $("#ctx").querySelectorAll("[data-k]").forEach(el =>
      el.oninput = () => {
        const i = +el.dataset.k;
        const was = CTX[i][0];
        CTX[i][0] = el.value;
        const vals = SUGG.context_values[el.value] || [];
        if (was !== el.value && vals.length === 1 && !CTX[i][1]) {
          CTX[i][1] = vals[0];
          const vEl = $("#ctx").querySelector(`[data-v="${i}"]`);
          if (vEl) vEl.value = vals[0];
        }
        const dl = document.getElementById(`vals-${i}`);
        if (dl) dl.innerHTML = vals.map(v => `<option value="${esc(v)}"></option>`).join("");
      });
    $("#ctx").querySelectorAll("[data-v]").forEach(el =>
      el.oninput = () => CTX[+el.dataset.v][1] = el.value);
    $("#ctx").querySelectorAll("[data-x]").forEach(el =>
      el.onclick = () => { CTX.splice(+el.dataset.x, 1); $("#ctx").innerHTML = rows(); bind(); });
  };
  bind();
  $("#ctx-add").onclick = () => { CTX.push(["", ""]); $("#ctx").innerHTML = rows(); bind(); };
  $("#n-save").onclick = async () => {
    const title = $("#n-title").value.trim();
    if (!title) { $("#n-err").textContent = "A title, at least."; return; }
    const fsel = $("#n-folder");
    const created = await api(`/projects/${PROJECT.id}/experiments`, "POST", {
      title, question: $("#n-question").value.trim(),
      context: Object.fromEntries(CTX.filter(([k, v]) => k.trim() && v.trim())),
      parent_experiment_id: parentId || null,
      folder_id: fsel && fsel.value ? +fsel.value : null,
      mode: $("#n-cycle").checked ? "cycle" : "notebook",
    });
    EXP = created;
    await refreshList(created.id);
  };
}

document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  TAB = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === t));
  if (TAB === "papers" && ZSTATUS.ready && !ZITEMS.length) loadPapers();
  else renderRail();
});

$("#btn-new").onclick = () => renderNewExperiment();

$("#btn-pen").onclick = () => {
  if (!EXP) return;
  PEN.open = !PEN.open;
  $("#btn-pen").classList.toggle("ai", PEN.open);
  render();
  if (PEN.open) $("#pad").scrollIntoView({ behavior: "smooth", block: "center" });
};

$("#btn-folder").onclick = async () => {
  const name = prompt("Folder name, for example a protocol you run repeatedly:");
  if (!name) return;
  FOLDERS = await api(`/projects/${PROJECT.id}/folders`, "POST", { name });
  renderLog();
};

$("#btn-brief").onclick = async () => {
  $("#modal-body").innerHTML = `<h2>Supervisor brief</h2>
    <p class="small muted">${SPIN} Assembling from your record</p>`;
  modal.showModal();
  try {
    const { markdown } = await api(`/projects/${PROJECT.id}/brief`);
    $("#modal-body").innerHTML = `<h2>Supervisor brief</h2>
      <p class="small muted">Compiled from what you wrote. No claim here is new.</p>
      <div class="brief">${esc(markdown).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</div>`;
  } catch (e) {
    $("#modal-body").innerHTML = `<h2>Supervisor brief</h2><div class="err">${esc(e.message)}</div>`;
  }
};

$("#btn-graph").onclick = async () => {
  const [g, cal] = await Promise.all([
    api(`/projects/${PROJECT.id}/graph`),
    api(`/projects/${PROJECT.id}/calibration`),
  ]);
  const byParent = {};
  g.nodes.forEach(n => (byParent[n.parent || 0] ||= []).push(n));
  const draw = (pid, depth) => (byParent[pid] || []).map(n => {
    const move = n.confidence_after != null && n.confidence_after !== n.confidence
      ? ` <span class="chip mini">${n.confidence} to ${n.confidence_after}</span>` : "";
    return `<div style="margin-left:${depth * 20}px;padding:7px 0;${depth ? "border-left:1px solid var(--rule);padding-left:13px" : ""}">
      <strong>${esc(n.title)}</strong>${n.confidence != null
        ? ` <span class="conf muted small">confidence ${n.confidence}</span>` : ""}${move}
      ${n.stance ? ` <span class="chip mini">${esc(n.stance)}</span>` : ""}
      ${!n.challenged ? ` <span class="chip mini">unchallenged</span>` : ""}
    </div>${draw(n.id, depth + 1)}`;
  }).join("");

  const stances = Object.entries(cal.stance_counts || {});
  const pending = g.awaiting_verdict || [];
  $("#modal-body").innerHTML = `<h2>Decision graph</h2>
    <p class="small muted">Every branch is a question you chose to follow, and the ones beside it
    that you did not.</p>
    ${draw(0, 0) || "<div class='small muted'>No experiments yet.</div>"}
    <h3 style="margin-top:22px">Calibration</h3>
    ${cal.resolved_n
      ? `<div class="small">${cal.resolved_n} resolved call${cal.resolved_n > 1 ? "s" : ""}.
         Brier score <strong>${cal.brier_score}</strong>
         <span class="muted">(0 is perfect, 0.25 is a coin flip)</span></div>
         ${Object.entries(cal.buckets).map(([k, b]) =>
           `<div class="small">Said ${k}: right ${b.mean_actual}% of the time
            <span class="muted">(n=${b.n}, gap ${b.gap > 0 ? "+" : ""}${b.gap})</span></div>`).join("")}`
      : `<div class="small muted">Nothing resolved yet. Mark commitments held or overturned once
         you know, and this becomes a calibration curve.</div>`}
    ${stances.length ? `<h3 style="margin-top:18px">After being challenged</h3>
      <div class="small">${stances.map(([s, n]) => `${s}: ${n}`).join(", ")}
      <span class="muted">Never moving is stubbornness; always moving is deference.</span></div>` : ""}
    ${pending.length ? `<h3 style="margin-top:22px">Awaiting a verdict</h3>
      <p class="tiny muted" style="margin-top:-6px">Calibration only counts calls whose outcome
      you have recorded. These are still open.</p>
      ${pending.map(x => `<div class="small" style="padding:4px 0">
        <button class="link" data-goto="${x.commitment_id}">${esc(x.title)}</button>
        <span class="muted">stated ${x.confidence}</span>
      </div>`).join("")}` : ""}`;
  $("#modal-body").querySelectorAll("[data-goto]").forEach(el => el.onclick = async () => {
    const node = g.nodes.find(n => n.commitment_id === +el.dataset.goto);
    modal.close();
    if (node) await openExperiment(node.id);
  });
  modal.showModal();
};

let REAGENTS = [];

function pctLeft(r) {
  if (!r.amount_total || r.amount_left == null) return null;
  return Math.max(0, Math.min(100, Math.round(100 * r.amount_left / r.amount_total)));
}

async function openBench() {
  REAGENTS = await api(`/projects/${PROJECT.id}/reagents`);
  const restock = await api(`/projects/${PROJECT.id}/restock`);
  modal.classList.add("wide");
  $("#modal-body").innerHTML = `
    <h2>The bench</h2>
    <p class="small muted">What you have, what is in it, where you left it, and how much is
    left. Low stock is arithmetic, not a guess.</p>

    ${restock.length ? `<div class="card" style="background:#fdf8ef;border-color:#eadfc6">
      <h3 style="color:#8a6a35">Tell the lab manager</h3>
      ${restock.map(r => `<div class="small" style="margin-bottom:5px">
        <strong>${esc(r.name)}</strong>
        ${r.status === "out" ? "is out" : `is down to ${r.amount_left}${esc(r.unit)}`}
        ${r.percent_left != null ? `<span class="muted">(${r.percent_left}%)</span>` : ""}
        ${r.supplier ? `<span class="muted">, ${esc(r.supplier)} ${esc(r.catalogue)}</span>` : ""}
      </div>`).join("")}
      <button class="ghost sm" id="copy-restock" style="margin-top:8px">Copy as a list</button>
      <span class="tiny muted" id="copied" style="margin-left:8px"></span>
    </div>` : ""}

    <div class="shelf">
      ${REAGENTS.map(r => {
        const p = pctLeft(r);
        return `<div class="vial ${r.status}" data-reagent="${r.id}">
          ${r.status !== "ok" ? `<div class="flag">${r.status === "out" ? "out" : "low"}</div>` : ""}
          ${p != null ? `<div class="fill" style="height:${p}%"></div>` : ""}
          <div class="nm">${esc(r.name)}</div>
          <div class="sub">${esc(r.supplier || r.kind)}${r.lot ? `, lot ${esc(r.lot)}` : ""}</div>
          <div class="amt">${r.amount_left != null
            ? `${r.amount_left}${esc(r.unit)}${r.amount_total ? ` of ${r.amount_total}` : ""}`
            : `<span class="muted">no amount tracked</span>`}</div>
          ${r.location ? `<div class="loc">${esc(r.location)}</div>` : ""}
        </div>`;
      }).join("")}
      <div class="vial" id="add-reagent" style="border-style:dashed;justify-content:center;
        align-items:center;color:var(--ink-3)">+ Add something</div>
    </div>`;
  modal.showModal();

  const copy = $("#copy-restock");
  if (copy) copy.onclick = async () => {
    const text = restock.map(r =>
      `${r.name}${r.lot ? ` (lot ${r.lot})` : ""}: ${r.status === "out" ? "out" : `${r.amount_left}${r.unit} left`}`
      + `${r.supplier ? `, ${r.supplier} ${r.catalogue}` : ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    $("#copied").textContent = "copied";
  };
  $("#modal-body").querySelectorAll("[data-reagent]").forEach(el =>
    el.onclick = () => openReagent(+el.dataset.reagent));
  $("#add-reagent").onclick = () => reagentForm(null);
}

async function openReagent(id) {
  const r = await api(`/reagents/${id}`);
  const p = pctLeft(r);
  modal.classList.add("wide");
  $("#modal-body").innerHTML = `
    <button class="link" id="back-bench">back to the bench</button>
    <h2 style="margin-top:8px">${esc(r.name)}</h2>
    <div class="small muted">${esc(r.kind)}${r.status !== "ok"
      ? ` <span class="pill ${r.status === "out" ? "" : "on"}">${r.status}</span>` : ""}</div>

    <dl class="kv" style="margin-top:16px">
      ${r.supplier ? `<dt>Supplier</dt><dd>${esc(r.supplier)} ${esc(r.catalogue)}</dd>` : ""}
      ${r.lot ? `<dt>Lot</dt><dd>${esc(r.lot)}</dd>` : ""}
      ${r.concentration ? `<dt>Concentration</dt><dd>${esc(r.concentration)}</dd>` : ""}
      ${r.amount_left != null ? `<dt>Left</dt><dd>${r.amount_left}${esc(r.unit)}${
        r.amount_total ? ` of ${r.amount_total}${esc(r.unit)}` : ""}${
        p != null ? ` <span class="muted">(${p}%)</span>` : ""}</dd>` : ""}
      ${r.location ? `<dt>Where</dt><dd>${esc(r.location)}</dd>` : ""}
      ${r.opened_at ? `<dt>Opened</dt><dd>${esc(r.opened_at)}</dd>` : ""}
      ${r.expires_at ? `<dt>Expires</dt><dd>${esc(r.expires_at)}</dd>` : ""}
    </dl>
    ${r.notes ? `<p class="small" style="margin-top:14px">${esc(r.notes)}</p>` : ""}

    ${r.components.length ? `<h3 style="margin-top:22px">What is in it</h3>
      <dl class="kv">${r.components.map(c => `
        <dt style="text-transform:none;font-weight:400;font-size:13px;color:var(--ink)">
          ${esc(c.name)}</dt>
        <dd>${esc(c.final_conc)}
          ${c.source_name ? `<span class="muted">from ${esc(c.source_name)}${
            c.source_lot ? `, lot ${esc(c.source_lot)}` : ""}</span>` : ""}
          <button class="link" data-delcomp="${c.id}">remove</button></dd>`).join("")}</dl>`
      : ""}
    <div class="row" style="margin-top:10px">
      <input id="comp-name" placeholder="component" style="flex:2">
      <input id="comp-conc" placeholder="final conc." style="flex:1">
      <select id="comp-src" style="flex:1.4">
        <option value="">made from</option>
        ${REAGENTS.filter(x => x.id !== r.id).map(x =>
          `<option value="${x.id}">${esc(x.name)}</option>`).join("")}
      </select>
      <button class="ghost sm" id="comp-add">Add</button>
    </div>

    ${r.used_in.length ? `<div class="small muted" style="margin-top:12px">
      Goes into: ${r.used_in.map(u => esc(u.name)).join(", ")}.</div>` : ""}

    <h3 style="margin-top:24px">Used in</h3>
    ${r.uses.length ? r.uses.map(u => `<div class="small" style="margin-bottom:5px">
      ${u.experiment_title ? `<strong>${esc(u.experiment_title)}</strong>` : "<em>no entry</em>"}
      ${u.amount ? `, ${u.amount}${esc(r.unit)}` : ""}
      ${u.note ? `, ${esc(u.note)}` : ""}
      <span class="muted tiny">${u.created_at.slice(0, 10)}</span>
      <button class="link" data-deluse="${u.id}">undo</button>
    </div>`).join("") : `<div class="small muted">Not logged against anything yet.</div>`}

    <div class="row" style="margin-top:12px">
      <input id="use-amt" type="number" step="any" placeholder="amount" style="flex:1">
      <input id="use-note" placeholder="what for" style="flex:2">
      <button class="ghost sm" id="use-add">Log use${EXP ? " here" : ""}</button>
    </div>
    ${EXP ? `<div class="tiny muted" style="margin-top:5px">Logs against
      <strong>${esc(EXP.title)}</strong> and subtracts from stock.</div>` : ""}

    <div class="row" style="margin-top:22px">
      <button class="ghost sm" id="edit-reagent">Edit details</button>
      <button class="ghost sm" id="archive-reagent">Archive</button>
    </div>
    <div class="err" id="r-err"></div>`;

  $("#back-bench").onclick = openBench;
  $("#comp-add").onclick = async () => {
    const name = $("#comp-name").value.trim();
    if (!name) return;
    await api(`/reagents/${id}/components`, "POST", {
      name, final_conc: $("#comp-conc").value.trim(),
      source_reagent_id: $("#comp-src").value ? +$("#comp-src").value : null,
    });
    openReagent(id);
  };
  $("#modal-body").querySelectorAll("[data-delcomp]").forEach(el => el.onclick = async () => {
    await api(`/components/${el.dataset.delcomp}`, "DELETE"); openReagent(id);
  });
  $("#use-add").onclick = async () => {
    const amt = $("#use-amt").value;
    await api(`/reagents/${id}/use`, "POST", {
      experiment_id: EXP ? EXP.id : null,
      amount: amt ? +amt : null, note: $("#use-note").value.trim(),
    });
    if (EXP) EXP = await api(`/experiments/${EXP.id}`);
    render();
    openReagent(id);
  };
  $("#modal-body").querySelectorAll("[data-deluse]").forEach(el => el.onclick = async () => {
    await api(`/uses/${el.dataset.deluse}`, "DELETE");
    if (EXP) { EXP = await api(`/experiments/${EXP.id}`); render(); }
    openReagent(id);
  });
  $("#edit-reagent").onclick = () => reagentForm(r);
  $("#archive-reagent").onclick = async () => {
    await api(`/reagents/${id}`, "DELETE"); openBench();
  };
}

function reagentForm(r) {
  const v = (k, d = "") => esc(r && r[k] != null ? r[k] : d);
  $("#modal-body").innerHTML = `
    <button class="link" id="back-bench2">back to the bench</button>
    <h2 style="margin-top:8px">${r ? "Edit" : "Add"}</h2>
    <label>Name</label><input id="f-name" value="${v("name")}">
    <div class="ctx-row" style="grid-template-columns:1fr 1fr">
      <div><label>Supplier</label><input id="f-supplier" value="${v("supplier")}"></div>
      <div><label>Catalogue</label><input id="f-cat" value="${v("catalogue")}"></div>
    </div>
    <div class="ctx-row" style="grid-template-columns:1fr 1fr">
      <div><label>Lot</label><input id="f-lot" value="${v("lot")}"></div>
      <div><label>Concentration</label><input id="f-conc" value="${v("concentration")}"></div>
    </div>
    <div class="ctx-row" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <div><label>Total</label><input id="f-total" type="number" step="any" value="${v("amount_total")}"></div>
      <div><label>Left</label><input id="f-left" type="number" step="any" value="${v("amount_left")}"></div>
      <div><label>Unit</label><input id="f-unit" value="${v("unit")}"></div>
      <div><label>Warn at</label><input id="f-low" type="number" step="any" value="${v("low_at")}"></div>
    </div>
    <label>Where you left it <span class="hint">Be specific. Shelf 3 of the minus 20, box B3.</span></label>
    <input id="f-loc" value="${v("location")}">
    <div class="ctx-row" style="grid-template-columns:1fr 1fr">
      <div><label>Opened</label><input id="f-opened" type="date" value="${v("opened_at")}"></div>
      <div><label>Expires</label><input id="f-exp" type="date" value="${v("expires_at")}"></div>
    </div>
    <label>Notes</label><textarea id="f-notes" rows="2">${v("notes")}</textarea>
    <div style="margin-top:16px"><button id="f-save">Save</button></div>
    <div class="err" id="f-err"></div>`;
  $("#back-bench2").onclick = openBench;
  $("#f-save").onclick = async () => {
    const num = (id) => $(id).value === "" ? null : +$(id).value;
    const body = {
      name: $("#f-name").value.trim(), kind: (r && r.kind) || "reagent",
      supplier: $("#f-supplier").value.trim(), catalogue: $("#f-cat").value.trim(),
      lot: $("#f-lot").value.trim(), concentration: $("#f-conc").value.trim(),
      unit: $("#f-unit").value.trim(), amount_total: num("#f-total"),
      amount_left: num("#f-left"), low_at: num("#f-low"),
      location: $("#f-loc").value.trim(), opened_at: $("#f-opened").value,
      expires_at: $("#f-exp").value, notes: $("#f-notes").value.trim(),
    };
    if (!body.name) { $("#f-err").textContent = "A name, at least."; return; }
    try {
      if (r) await api(`/reagents/${r.id}`, "PUT", body);
      else await api(`/projects/${PROJECT.id}/reagents`, "POST", body);
      openBench();
    } catch (e) { $("#f-err").textContent = e.message; }
  };
}

$("#btn-bench").onclick = openBench;

boot();
