const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ul = (items, cls) =>
  `<ul class="ev ${cls}">${(items || []).map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
const pad2 = (n) => String(n).padStart(2, "0");

let PROJECT = null, EXP = null, CTX = [], TAB = "ref";
let GLOSS = [], MATCHES = [], CONNS = [], FOLDERS = [], LOG = [];
let TSTATUS = { ready: false, missing: [] };
let ZSTATUS = { ready: false }, ZCOLLS = [], ZITEMS = [], ZALL = {};
let ZFILTER = { coll: "", engaged: true };
let SUGG = { context_keys: [], context_values: {}, terms: [] };

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
    const st = e.stage || "notice";
    return `<div class="log-item ${EXP && e.id === EXP.id ? "on" : ""}"
      draggable="true" data-id="${e.id}">
      <div class="t">${esc(e.title)}</div>
      <div class="log-meta">
        <span class="badge ${st}">${st}</span>
        <span class="date">${e.created_at.slice(0, 10)}</span>
        ${e.recording_count ? `<span class="date">${e.recording_count} voice</span>` : ""}
      </div>
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
    el.onclick = () => openExperiment(+el.dataset.id));
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
  const at = STAGE_ORDER.indexOf(stageOf(EXP));
  $("#now-title").textContent = EXP ? EXP.title : "";
  $("#stages").innerHTML = STAGE_ORDER.map((s, i) => {
    const cls = i < at ? "done" : i === at ? "now" : "";
    return `<div class="stage ${cls}"><span class="num">${pad2(i + 1)}</span>${
      STAGE_ICON[s]}${s}</div>`;
  }).join(`<span class="stage-arrow">&rarr;</span>`);
}

async function openExperiment(id) {
  EXP = await api(`/experiments/${id}`);
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

  const banner = c
    ? `<div class="banner">&#128275; Your view is committed. Challenge unlocked.</div>`
    : `<div class="banner wait">&#128274; Write your own reading first. The challenge stays locked until you do.</div>`;

  $("#main").innerHTML = `
    ${banner}
    <div class="card">
      <h2>${esc(EXP.title)}</h2>
      ${EXP.question ? `<div class="qline"><b>Q:</b> ${esc(EXP.question)}</div>` : ""}
      ${ctx.length ? `<div class="ctx">${ctx.map(([k, v]) =>
        `<b>${esc(k)}:</b> ${esc(v)}`).join("&nbsp;&nbsp; ")}</div>` : ""}

      <h3 style="margin-top:20px">Bench notes</h3>
      ${EXP.notes.length
        ? EXP.notes.map(n => `<div class="small" style="margin-bottom:6px">
            ${esc(n.body)}
            <span class="muted tiny">${n.source === "voice" ? "dictated, " : ""}${n.created_at.slice(0, 10)}</span>
          </div>`).join("")
        : `<div class="small muted">The things that decide whether it worked and never reach
           the spreadsheet. Consistency of a gel, a line that looked unhappy, beads sitting low.</div>`}
      <div class="row" style="margin-top:10px">
        <input id="note" placeholder="Add an observation…" list="note-terms">
        <datalist id="note-terms">
          ${SUGG.terms.map(t => `<option value="${esc(t)}"></option>`).join("")}
        </datalist>
        <button class="ghost sm" id="btn-note">Add</button>
      </div>
    </div>
    ${renderLinkedPapers()}
    ${renderConnectorOutput()}
    ${c ? renderCommitment(c) : renderCommitForm()}
    ${c ? (ch ? renderChallenge(ch, c, resp) : renderChallengeGate()) : ""}
  `;
  wire(c, ch);
}

function renderCommitment(c) {
  return `<div class="commitcard">
    <div class="hd">
      <span class="l">Your committed interpretation</span>
      <span class="p">preserved</span>
    </div>
    <div style="font-size:15.5px;line-height:1.6">${esc(c.interpretation)}</div>
    <div class="meter">
      <div class="bar"><div class="fill" style="width:${c.confidence}%"></div></div>
      <div class="v">${c.confidence}% confidence</div>
    </div>
    <dl style="margin:0">
      <dt>Expected</dt><dd>${esc(c.expected)}</dd>
      <dt>Observed</dt><dd>${esc(c.observed)}</dd>
      <dt>Would change your mind</dt><dd>${esc(c.disconfirming)}</dd>
      ${c.proposed_next ? `<dt>Next experiment you proposed</dt><dd>${esc(c.proposed_next)}</dd>` : ""}
    </dl>
    <div class="tiny muted" style="margin-top:16px">
      Locked ${c.locked_at.replace("T", " ").slice(0, 16)}. Your words, unedited.
    </div>
  </div>`;
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
    <h3>Your view, before anything answers</h3>
    <p class="small muted" style="margin-top:-4px">
      Once you lock this it cannot be edited. That is the whole mechanism: what you thought
      before the model spoke has to survive intact, or none of it means anything later.</p>
    <label>What did you expect?
      <span class="hint">Before you ran it. Say it even if it turned out wrong, especially then.</span></label>
    <textarea id="f-expected" rows="2"></textarea>
    <label>What did you actually observe?
      <span class="hint">The observation, not yet the reading of it.</span></label>
    <textarea id="f-observed" rows="3"></textarea>
    <label>What do you think happened?
      <span class="hint">Your interpretation. Commit to one.</span></label>
    <textarea id="f-interpretation" rows="3"></textarea>
    <label>How confident are you? <span id="conflabel" class="conf">60</span>/100
      <span class="hint">Honestly, not defensively. Being under-confident costs you as much
      as being over-confident.</span></label>
    <input type="range" id="f-confidence" min="0" max="100" value="60" style="padding:0">
    <label>What result would change your mind?
      <span class="hint">If you cannot name one, you are not holding a hypothesis yet.</span></label>
    <textarea id="f-disconfirming" rows="2"></textarea>
    <label>What should the next experiment be? <span class="hint">Optional.</span></label>
    <textarea id="f-next" rows="2"></textarea>
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
    <div class="sub" style="color:var(--navy);border-top-color:var(--rule)">On your stated confidence of ${c.confidence}</div>
    <div class="small">${esc(d.confidence_note)}</div>
  </div>` : ""}

  ${resp ? `<div class="locked">
      <div class="stamp">You ${esc(resp.stance)} your position. Confidence ${c.confidence} to ${resp.confidence_after}</div>
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
      <label>Confidence now: <span id="r-conflabel" class="conf">${c.confidence}</span>/100</label>
      <input type="range" id="r-confidence" min="0" max="100" value="${c.confidence}" style="padding:0">
      <label>What are you doing next, and why that?</label>
      <textarea id="r-next" rows="2"></textarea>
      <div style="margin-top:15px"><button id="btn-respond">Record decision</button></div>
      <div class="err" id="r-err"></div>
    </div>`}`;
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
  $("#g-detect").onclick = async (e) => {
    const b = e.target;
    b.disabled = true; b.innerHTML = `<span class="spin">◐</span> reading…`;
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
  if (e.target.id === "selpop") return;
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

$("#selpop").onclick = async () => {
  const pop = $("#selpop");
  const term = SELTERM;
  pop.textContent = "…";
  try {
    const entry = await api(`/projects/${PROJECT.id}/glossary/define`, "POST",
      { term, experiment_id: EXP ? EXP.id : null });
    GLOSS = await api(`/projects/${PROJECT.id}/glossary`);
    MATCHES = await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`);
    TAB = "ref";
    document.querySelectorAll(".tab").forEach(x =>
      x.classList.toggle("on", x.dataset.tab === "ref"));
    renderRail();
    showDef(entry);
  } catch (err) {
    $("#def-detail") ? $("#def-detail").innerHTML =
      `<div class="err">${esc(err.message)}</div>` : alert(err.message);
  }
  pop.textContent = "Define";
  pop.style.display = "none";
  window.getSelection().removeAllRanges();
};

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
          <div class="small" style="font-weight:500">${esc(r.filename)}</div>
          <div class="tiny muted">${r.duration_s ? `${r.duration_s}s, ` : ""}${r.created_at.slice(0, 10)}</div>
          <audio controls preload="none" src="/api/recordings/${r.id}/audio"></audio>
          ${r.transcript
            ? `<div class="verbatim">${esc(r.transcript)}</div>
               <div class="tiny muted" style="margin-top:5px">${esc(r.transcript_engine)}</div>
               <div class="row" style="margin-top:7px">
                 <button class="ghost sm" data-note="${r.id}">Add to bench notes</button>
                 <button class="link" data-edit="${r.id}">edit</button>
               </div>`
            : `<div class="row" style="margin-top:7px">
                 <button class="ghost sm" data-tr="${r.id}" ${TSTATUS.ready ? "" : "disabled"}>Transcribe</button>
                 <button class="link" data-edit="${r.id}">type it myself</button>
               </div>`}
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

  $("#rail").querySelectorAll("[data-tr]").forEach(el => el.onclick = async () => {
    el.disabled = true; el.innerHTML = `<span class="spin">◐</span> transcribing…`;
    try {
      EXP = await api(`/recordings/${el.dataset.tr}/transcribe`, "POST");
      render(); renderRail();
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
  renderRail();
}

function renderPapersRail() {
  if (!ZSTATUS.ready) {
    $("#rail").innerHTML = `<div class="ref-body"><h3>Papers</h3>
      <div class="small" style="color:#8d3b32">${esc(ZSTATUS.detail || "Zotero not found.")}</div>
      <div class="tiny muted" style="margin-top:8px">Benchcraft reads your local Zotero library
      directly. Nothing is uploaded and no account is connected.</div></div>`;
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
    <div class="err tiny" id="z-err"></div></div>`;

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
}

async function openPaper(key) {
  $("#modal-body").innerHTML = `<p class="small muted"><span class="spin">◐</span> loading…</p>`;
  modal.showModal();
  drawPaper(await api(`/papers/${key}`));
}

function drawPaper(p) {
  const it = p.item, d = p.digest;
  $("#modal-body").innerHTML = `
    <h2 style="font-size:19px">${esc(it.title)}</h2>
    <div class="small muted">${esc(it.authors.join(", "))}${it.more_authors ? " et al." : ""}
      ${it.date ? `, ${esc(it.date)}` : ""}${it.journal ? `, ${esc(it.journal)}` : ""}</div>
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
    dig.innerHTML = `<span class="spin">◐</span> reading…`;
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
      <input id="c-endpoint" placeholder="https://… endpoint" style="margin-bottom:5px">
      <input id="c-key" placeholder="env var holding the key (optional)" style="margin-bottom:5px">
      <label style="margin:6px 0 4px"><input type="checkbox" id="c-on" style="width:auto"> enabled</label>
      <button class="ghost sm" id="c-add" style="width:100%">Add</button>
    </div>
    <div style="margin-top:14px"><h3>Suggested</h3>
      <div id="c-sugg" class="tiny muted">…</div></div></div>`;

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
  $("#main").querySelectorAll("[data-openc]").forEach(el =>
    el.onclick = () => openPaper(el.dataset.openc));

  const conf = $("#f-confidence");
  if (conf) conf.oninput = () => $("#conflabel").textContent = conf.value;
  const rconf = $("#r-confidence");
  if (rconf) rconf.oninput = () => $("#r-conflabel").textContent = rconf.value;

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
      const out = await api(`/experiments/${EXP.id}/commitments`, "POST", {
        expected: $("#f-expected").value.trim(),
        observed: $("#f-observed").value.trim(),
        interpretation: $("#f-interpretation").value.trim(),
        confidence: +$("#f-confidence").value,
        disconfirming: $("#f-disconfirming").value.trim(),
        proposed_next: $("#f-next").value.trim(),
      });
      EXP = out.experiment;
      render(); renderStages(); renderRail(); reloadLog();
    } catch (e) { lock.disabled = false; $("#lock-err").textContent = e.message; }
  };

  const btnCh = $("#btn-challenge");
  if (btnCh) btnCh.onclick = async () => {
    btnCh.disabled = true;
    btnCh.innerHTML = `<span class="spin">◐</span> thinking against you…`;
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
        confidence_after: +$("#r-confidence").value,
        chosen_next: $("#r-next").value.trim(),
      });
      render(); renderStages(); reloadLog();
    } catch (e) { btnR.disabled = false; $("#r-err").textContent = e.message; }
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

$("#btn-folder").onclick = async () => {
  const name = prompt("Folder name, for example a protocol you run repeatedly:");
  if (!name) return;
  FOLDERS = await api(`/projects/${PROJECT.id}/folders`, "POST", { name });
  renderLog();
};

$("#btn-brief").onclick = async () => {
  $("#modal-body").innerHTML = `<h2>Supervisor brief</h2>
    <p class="small muted"><span class="spin">◐</span> Assembling from your record…</p>`;
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
      <span class="muted">Never moving is stubbornness; always moving is deference.</span></div>` : ""}`;
  modal.showModal();
};

boot();
