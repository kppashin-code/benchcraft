// Claims you stand behind: what each rests on, who challenged it, and how you answered.
import * as B from "./lib/backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);
const BASIS = { own: "checked myself", relied: "relying on someone", agent: "first suggested by AI" };
const BY = { me: "me", colleague: "colleague", reviewer: "reviewer", agent: "agent" };
const OUT = { stands: "it stands", revised: "revised", withdrawn: "withdrawn" };

// Everything in an entry a claim can rest on, as pickable chips.
export function evidenceOf(exp, papers = {}) {
  if (!exp) return [];
  const cut = (t, n = 70) => { t = String(t || ""); return t.length > n ? t.slice(0, n) + "…" : t; };
  const out = [];
  for (const n of exp.notes) out.push({ k: "note", id: String(n.id), label: cut(n.body) });
  for (const d of exp.datasets) out.push({ k: "dataset", id: String(d.id), label: d.label || d.filename });
  for (const f of exp.figures || []) out.push({ k: "figure", id: String(f.id), label: f.caption });
  for (const c of exp.commitments) out.push({ k: "reading", id: String(c.id), label: `reading ${c.locked_at.slice(0, 10)}: ${cut(c.interpretation, 50)}` });
  for (const a of exp.advice || []) out.push({ k: "advice", id: String(a.id), label: `${a.source_name || a.source_type}: ${cut(a.said, 50)}` });
  for (const p of exp.papers) out.push({ k: "paper", id: p.zotero_key, label: (papers[p.zotero_key] || {}).title || p.zotero_key });
  return out;
}

function badge(c) {
  if (c.status === "withdrawn") return `<span class="cl-badge gone">withdrawn</span>`;
  if (c.answerable) return `<span class="cl-badge ok">you can answer for this</span>`;
  return `<span class="cl-badge thin" title="${esc(c.missing.join(", "))}">${esc(c.missing[0])}</span>`;
}

function challengeBlock(c, x) {
  const who = x.by_type === "agent" ? "Agent" : `${esc(BY[x.by_type] || x.by_type)}${x.by_name ? `, ${esc(x.by_name)}` : ""}`;
  const qs = x.by_type === "agent" ? `<ul class="ev q">${x.text.split("\n").map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
      ${x.weakest_link ? `<div class="small"><strong>Weakest link:</strong> ${esc(x.weakest_link)}</div>` : ""}
      ${x.would_withdraw_if ? `<div class="small muted">Would withdraw it if: ${esc(x.would_withdraw_if)}</div>` : ""}
      ${(x.on_earlier || []).length ? `<div class="sub">On what it asked before</div><ul class="ev">${x.on_earlier.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`
    : `<div class="small">${esc(x.text)}</div>`;
  const a = x.answer;
  return `<div class="cl-ch ${a ? "done" : "owed"}">
    <div class="tiny muted">${who} &middot; ${x.created_at.slice(0, 10)}${a ? "" : ` &middot; <span class="owed-tag">waiting on your answer</span>`}</div>
    ${qs}
    ${a ? `<div class="cl-ans"><span class="pill">${esc(OUT[a.outcome])}</span> ${esc(a.text)}${a.new_text ? `<div class="tiny muted">now reads: ${esc(a.new_text)}</div>` : ""}</div>`
      : c.status === "withdrawn" ? "" : `<div class="cl-answer" data-ansfor="${x.id}">
        <div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(OUT).map(([k, l]) => `<button class="wt" data-out="${k}">${l}</button>`).join("")}</div>
        <textarea rows="2" class="cl-reason" placeholder="your answer: what it rests on, or what changed"></textarea>
        <textarea rows="2" class="cl-new" placeholder="the revised claim" hidden>${esc(c.text)}</textarea>
        <button class="ghost sm cl-send">Answer</button></div>`}
  </div>`;
}

function historyLine(e) {
  const t = { asserted: "claimed", revised: "reworded", withdrawn: "withdrew it", restated: "stood by it again", asked: `asked ${esc(e.by_name)} to find the weak point`, challenged: `challenged by ${esc(e.by_type === "agent" ? "the agent" : e.by_name || e.by_type)}`, answered: `answered: ${esc(OUT[e.outcome])}` }[e.type] || e.type;
  return `<li><span class="tiny muted">${e.created_at.slice(0, 10)}</span> ${t}${e.type === "revised" ? `: <s>${esc(e.old_text)}</s>` : ""}${e.text && ["withdrawn", "restated", "revised"].includes(e.type) ? ` <span class="muted">(${esc(e.text)})</span>` : ""}</li>`;
}

export function claimRow(c, { ai, evidence, contacts, questions }) {
  // Without the entry open, the picker offers only what is already linked.
  evidence = evidence || (c.rests_on || []);
  const ev = new Map(evidence.map((x) => [`${x.k}:${x.id}`, x]));
  const on = new Set((c.rests_on || []).map((r) => `${r.k}:${r.id}`));
  const q = (questions || []).find((x) => x.id === c.question_id);
  return `<div class="claim ${c.status === "withdrawn" ? "withdrawn" : ""}" data-claim="${c.id}">
    <div class="row" style="gap:8px;align-items:flex-start">
      <div style="flex:1"><div class="cl-text">${esc(c.text)}</div>
        <div class="tiny muted">${esc(BASIS[c.basis] || "")}${c.basis === "relied" && c.relied_on ? `: ${esc(c.relied_on)}` : ""}${q ? ` &middot; answers: ${esc(q.text)}` : ""}${c.from_entry ? ` &middot; from a deleted entry, ${esc(c.from_entry)}` : ""}${c.entry_title ? ` &middot; <button class="link" data-goexp="${c.experiment_id}">${esc(c.entry_title)}</button>` : ""}</div></div>
      ${badge(c)}
    </div>
    ${(c.rests_on || []).length ? `<div class="chips cl-rests">${c.rests_on.map((r) => `<span class="chip mini" title="${esc(r.k)}">${esc((ev.get(`${r.k}:${r.id}`) || r).label)}</span>`).join("")}</div>` : ""}
    ${c.my_account ? `<div class="small cl-acct">${esc(c.my_account)}</div>` : ""}
    ${c.challenges.map((x) => challengeBlock(c, x)).join("")}
    <details class="cl-more"><summary class="tiny">${c.status === "withdrawn" ? "Record" : "Work on it"}</summary>
      ${c.status === "withdrawn" ? "" : `
      <label class="tiny">What it rests on</label>
      <div class="chips cl-pick">${(evidence || []).map((x) => `<span class="chip mini ${on.has(`${x.k}:${x.id}`) ? "on" : ""}" data-ev="${esc(x.k)}:${esc(x.id)}">${esc(x.k)}: ${esc(x.label)}</span>`).join("") || `<span class="tiny muted">Nothing in this entry to link yet.</span>`}</div>
      <label class="tiny">In your own words: why it holds, and how it works</label>
      <textarea rows="2" class="cl-acct-in">${esc(c.my_account || "")}</textarea>
      <div class="ctx-row" style="grid-template-columns:1fr 1fr 1fr">
        <select class="cl-basis">${Object.entries(BASIS).map(([k, l]) => `<option value="${k}" ${c.basis === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input class="cl-relied" placeholder="whose result or which paper" value="${esc(c.relied_on || "")}">
        <input class="cl-trust" placeholder="why you trust it" value="${esc(c.why_trust || "")}">
      </div>
      ${(questions || []).length ? `<select class="cl-q"><option value="">answers which question?</option>${questions.map((x) => `<option value="${x.id}" ${x.id === c.question_id ? "selected" : ""}>${esc(x.text)}</option>`).join("")}</select>` : ""}
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="ghost sm cl-save">Save</button>
        <button class="ghost sm cl-chal">Challenge it</button>
        ${ai ? `<button class="ai sm cl-agent">Have the agent question it</button>` : ""}
        <button class="ghost sm cl-ask">Ask a colleague</button>
        <button class="ghost sm cl-revise">Reword</button>
        <button class="ghost sm cl-withdraw">Withdraw</button>
      </div>
      <div class="cl-form"></div>`}
      ${c.status === "withdrawn" ? `<button class="ghost sm cl-restate">Stand by it again</button>` : ""}
      <ul class="cl-hist">${c.events.map(historyLine).join("")}</ul>
      ${c.challenges.length ? "" : `<button class="link cl-del">remove</button>`}
    </details>
    <div class="err tiny cl-err"></div>
  </div>`;
}

export function renderClaimsCard(exp, ctx) {
  const list = exp.claims || [];
  return `<div class="card" id="claims-card">
    <h3>Claims</h3>
    <p class="tiny muted" style="margin-top:-6px">What you would stand behind from this entry. Link what each rests on, put it in your own words, and answer the challenges.</p>
    ${list.map((c) => claimRow(c, ctx)).join("")}
    <details ${list.length ? "" : ""}><summary class="small">Add a claim</summary>
      <textarea id="cl-new" rows="2" placeholder="one sentence you would defend if asked"></textarea>
      <button class="ghost sm" id="cl-add" style="margin-top:6px">Add</button>
      <div class="err tiny" id="cl-add-err"></div>
    </details>
  </div>`;
}

// Wires every claim row inside root; done runs after each change.
export function wireClaims(root, { pid, experimentId, ask, contacts, done }) {
  const add = $("#cl-add", root);
  if (add) add.onclick = async () => {
    try { await B.api(`/projects/${pid}/claims`, "POST", { text: $("#cl-new", root).value, experiment_id: experimentId }); done(); }
    catch (e) { $("#cl-add-err", root).textContent = e.message; }
  };
  root.querySelectorAll("[data-claim]").forEach((row) => {
    const id = +row.dataset.claim;
    const err = (e) => { $(".cl-err", row).textContent = e.message; };
    const run = async (fn) => { try { await fn(); done(); } catch (e) { err(e); } };
    row.querySelectorAll("[data-ev]").forEach((ch) => ch.onclick = () => ch.classList.toggle("on"));
    const picked = () => [...row.querySelectorAll(".cl-pick [data-ev].on")].map((ch) => {
      const [k, ...rest] = ch.dataset.ev.split(":");
      return { k, id: rest.join(":"), label: ch.textContent.replace(/^[a-z]+: /, "") };
    });
    const btn = (cls, fn) => { const b = $(cls, row); if (b) b.onclick = fn; };
    btn(".cl-save", () => run(() => B.api(`/claims/${id}`, "PUT", {
      rests_on: picked(), my_account: $(".cl-acct-in", row).value, basis: $(".cl-basis", row).value,
      relied_on: $(".cl-relied", row).value, why_trust: $(".cl-trust", row).value,
      ...($(".cl-q", row) ? { question_id: $(".cl-q", row).value || null } : {}),
    })));
    const form = (html, onGo) => {
      const f = $(".cl-form", row);
      f.innerHTML = html + `<div class="row" style="gap:6px;margin-top:6px"><button class="ghost sm cl-go">Save</button><button class="link cl-x">cancel</button></div>`;
      $(".cl-x", f).onclick = () => { f.innerHTML = ""; };
      $(".cl-go", f).onclick = () => run(() => onGo(f));
    };
    btn(".cl-chal", () => form(`<div class="ctx-row" style="grid-template-columns:1fr 2fr;margin-top:8px">
        <select class="f-by"><option value="me">me, arguing the other side</option><option value="colleague">a colleague</option><option value="reviewer">a reviewer</option></select>
        <input class="f-name" placeholder="who"></div>
        <textarea class="f-text" rows="2" placeholder="the challenge, as they put it"></textarea>`,
      (f) => B.api(`/claims/${id}/challenges`, "POST", { by_type: $(".f-by", f).value, by_name: $(".f-name", f).value, text: $(".f-text", f).value })));
    btn(".cl-revise", () => form(`<textarea class="f-text" rows="2">${esc($(".cl-text", row).textContent)}</textarea><input class="f-why" placeholder="what changed">`,
      (f) => B.api(`/claims/${id}/revise`, "POST", { text: $(".f-text", f).value, reason: $(".f-why", f).value })));
    btn(".cl-withdraw", () => form(`<input class="f-why" placeholder="why you no longer stand behind it">`,
      (f) => B.api(`/claims/${id}/withdraw`, "POST", { reason: $(".f-why", f).value })));
    btn(".cl-restate", async () => { const r = await ask("What changed, that you stand by it again?"); if (r) run(() => B.api(`/claims/${id}/restate`, "POST", { reason: r })); });
    btn(".cl-ask", () => form(`<select class="f-who"><option value="">pick a contact</option>${(contacts || []).filter((c) => c.email).map((c) => `<option value="${c.id}">${esc(c.name || c.role)} (${esc(c.email)})</option>`).join("")}</select>
        <input class="f-email" placeholder="or an email address" style="margin-top:5px"><div class="tiny muted">Makes a Gmail draft for you to read and send.</div>`,
      async (f) => {
        const out = await B.api(`/claims/${id}/ask`, "POST", { contact_id: $(".f-who", f).value || null, email: $(".f-email", f).value });
        if (out.url) window.open(out.url, "_blank", "noopener");
      }));
    btn(".cl-agent", async () => {
      const b = $(".cl-agent", row); b.disabled = true; b.textContent = "Thinking…";
      await run(() => B.api(`/claims/${id}/agent_challenge`, "POST"));
      b.disabled = false; b.textContent = "Have the agent question it";
    });
    btn(".cl-del", (ev) => {
      const b = ev.target;
      if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "click again"; return; }
      run(() => B.api(`/claims/${id}`, "DELETE"));
    });
    row.querySelectorAll("[data-ansfor]").forEach((box) => {
      let out = "";
      box.querySelectorAll("[data-out]").forEach((b) => b.onclick = () => {
        out = b.dataset.out;
        box.querySelectorAll("[data-out]").forEach((x) => x.classList.toggle("on", x === b));
        $(".cl-new", box).hidden = out !== "revised";
      });
      $(".cl-send", box).onclick = () => run(() => B.api(`/claim_events/${box.dataset.ansfor}/answer`, "POST", { outcome: out, reason: $(".cl-reason", box).value, new_text: $(".cl-new", box).value }));
    });
  });
}

// ---------- the Claims window: every claim, the questions you chose, and what is owed ----------

let PID = null, VIEW = "claims", CTX = {}, OPEN_EXP = null;

export async function openClaims(projectId, { ai, ask, openEntry, tab } = {}) {
  PID = projectId; VIEW = tab || VIEW; CTX = { ai, ask }; OPEN_EXP = openEntry;
  const modal = document.getElementById("modal");
  modal.classList.add("wide");
  await draw();
  if (!modal.open) modal.showModal();
}

const QSTATUS = ["open", "pursuing", "parked", "yielded", "dropped"];

async function draw() {
  const [claims, questions, st, contacts] = await Promise.all([
    B.api(`/projects/${PID}/claims`), B.api(`/projects/${PID}/questions`), B.api(`/projects/${PID}/standing`), B.api(`/projects/${PID}/contacts`),
  ]);
  const body = $("#modal-body");
  const tabs = [["claims", "Claims"], ["owed", `Owed answers${st.owed.length ? ` (${st.owed.length})` : ""}`], ["questions", "Questions"]];
  let inner = "";
  if (VIEW === "claims") {
    const live = claims.filter((c) => c.status !== "withdrawn"), gone = claims.filter((c) => c.status === "withdrawn");
    inner = `<div class="cl-stats small">
        <span><b>${st.answerable}</b> of ${st.claims} you can answer for</span>
        <span><b>${st.relied}</b> relying on others</span>
        ${st.agent_unexplained ? `<span><b>${st.agent_unexplained}</b> from AI, not yet in your words</span>` : ""}
        <span><b>${st.answered}</b> of ${st.challenges} challenges answered</span>
        <span><b>${st.from_people}</b> from people</span>
        <span><b>${st.withdrawn}</b> withdrawn, <b>${st.revised}</b> reworded</span></div>
      ${live.map((c) => claimRow(c, { ...CTX, evidence: null, contacts, questions })).join("") || `<p class="small muted">No claims yet. Add one from any entry, or here.</p>`}
      ${gone.length ? `<details><summary class="small">Withdrawn (${gone.length})</summary>${gone.map((c) => claimRow(c, { ...CTX, evidence: null, contacts, questions })).join("")}</details>` : ""}
      <details><summary class="small">Add a claim that spans entries</summary>
        <textarea id="cl-new" rows="2" placeholder="one sentence you would defend if asked"></textarea>
        <button class="ghost sm" id="cl-add" style="margin-top:6px">Add</button><div class="err tiny" id="cl-add-err"></div></details>`;
  } else if (VIEW === "owed") {
    inner = st.owed.length ? st.owed.map((o) => `<div class="lab-row"><div><strong>${esc(o.claim)}</strong>
        <div class="tiny muted">${esc(o.by)} &middot; ${o.date}</div><div class="small">${esc(o.text.split("\n")[0])}</div></div>
        ${o.experiment_id ? `<span class="lab-acts"><button class="link" data-goexp="${o.experiment_id}">open entry</button></span>` : ""}</div>`).join("")
      : `<p class="small muted">Nothing waiting. Every challenge has an answer.</p>`;
  } else {
    const n = (q) => claims.filter((c) => c.question_id === q.id && c.status !== "withdrawn").length;
    inner = `<p class="small muted">The questions you chose to pursue, why they matter to you, and what each gave you once you followed it.</p>
      ${questions.map((q) => `<div class="lab-row" data-q="${q.id}"><div style="flex:1"><strong>${esc(q.text)}</strong> <span class="pill">${esc(q.status || "open")}</span>
        ${q.why ? `<div class="small muted">why it matters: ${esc(q.why)}</div>` : ""}
        ${q.yielded ? `<div class="small">it gave me: ${esc(q.yielded)}</div>` : ""}
        <div class="tiny muted">${n(q)} claim${n(q) === 1 ? "" : "s"} answer it</div></div>
        <span class="lab-acts"><select class="q-st">${QSTATUS.map((s) => `<option ${s === (q.status || "open") ? "selected" : ""}>${s}</option>`).join("")}</select>
        <button class="link q-yield">what it gave me</button></span></div>`).join("") || `<p class="small muted">None yet.</p>`}
      <h3 style="margin-top:16px">Add a question</h3>
      <input id="q-text" placeholder="the question"><input id="q-why" placeholder="why it matters to you" style="margin-top:5px">
      <button class="ghost sm" id="q-add" style="margin-top:6px">Add</button>`;
  }
  body.innerHTML = `<h2>Claims</h2>
    <div class="chips" style="margin:6px 0 16px">${tabs.map(([k, l]) => `<span class="chip fz-tab ${k === VIEW ? "on" : ""}" data-ct="${k}">${l}</span>`).join("")}</div>
    ${inner}<div class="err" id="ct-err"></div>`;
  body.querySelectorAll("[data-ct]").forEach((c) => c.onclick = () => { VIEW = c.dataset.ct; draw(); });
  body.querySelectorAll("[data-goexp]").forEach((b) => b.onclick = () => { document.getElementById("modal").close(); OPEN_EXP && OPEN_EXP(+b.dataset.goexp); });
  if (VIEW === "claims") wireClaims(body, { pid: PID, experimentId: null, ask: CTX.ask, contacts, done: draw });
  if (VIEW === "questions") {
    const err = (e) => { $("#ct-err").textContent = e.message; };
    $("#q-add").onclick = () => B.api(`/projects/${PID}/questions`, "POST", { text: $("#q-text").value, why: $("#q-why").value, status: "open" }).then(draw, err);
    body.querySelectorAll("[data-q]").forEach((row) => {
      const id = row.dataset.q;
      $(".q-st", row).onchange = (e) => B.api(`/questions/${id}`, "PUT", { status: e.target.value }).then(draw, err);
      $(".q-yield", row).onclick = async () => { const t = await CTX.ask("What did following this question give you?"); if (t) B.api(`/questions/${id}`, "PUT", { yielded: t }).then(draw, err); };
    });
  }
}

