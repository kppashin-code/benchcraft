// The Today page: maker and manager time, and everything in the notebook that needs you.
import * as B from "./lib/backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

let ROOT = null, PID = null, OPEN_EXP = null, OPEN_TOOL = null, T = null, EVENTS = [], CALEV = null, CALSTATE = "";
try { EVENTS = JSON.parse(localStorage.getItem("bc.icsEvents") || "[]"); } catch { EVENTS = []; }

export async function showToday(root, projectId, onOpenExperiment, onOpenTool) {
  ROOT = root; PID = projectId; OPEN_EXP = onOpenExperiment; OPEN_TOOL = onOpenTool;
  T = await B.api(`/projects/${PID}/today`);
  draw();
  // Each viewer's own Google Calendar, if they have connected it in claude.ai.
  try { CALEV = await B.api("/calendar/day"); CALSTATE = "on"; }
  catch (e) { CALEV = null; CALSTATE = /not_connected/.test(e.message) ? "off" : /not_granted/.test(e.message) ? "denied" : e.message; }
  draw();
}

// A small .ics reader: enough for Google Calendar exports.
function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let ev = null;
  const when = (v) => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?/.exec(v);
    if (!m) return null;
    const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
    return z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString() : new Date(+y, +mo - 1, +d, +h, +mi, +s).toISOString();
  };
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") { if (ev && ev.start) out.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(":");
      const key = line.slice(0, i).split(";")[0], val = line.slice(i + 1);
      if (key === "SUMMARY") ev.title = val.replace(/\\,/g, ",").replace(/\\n/g, " ");
      if (key === "DTSTART") { ev.start = when(val); ev.allDay = !val.includes("T"); }
      if (key === "DTEND") ev.end = when(val);
    }
  }
  return out;
}

function eventsToday() {
  const day = new Date().toDateString();
  if (CALEV) return CALEV.filter((e) => !e.allDay);
  return EVENTS.filter((e) => new Date(e.start).toDateString() === day && !e.allDay).sort((a, b) => (a.start < b.start ? -1 : 1));
}

function dayStrip() {
  const blocks = T.blocks;
  const todayBookings = T.bookings.filter((b) => new Date(b.start).toDateString() === new Date().toDateString());
  const evs = eventsToday();
  const items = [
    ...blocks.map((b) => ({ start: mins(b.start), end: mins(b.end), kind: b.type, label: b.label || (b.type === "maker" ? "Bench and deep work" : "Meetings and admin"), id: b.id, s: b.start, e: b.end })),
    ...todayBookings.map((b) => { const s = new Date(b.start), e = new Date(b.end); return { start: s.getHours() * 60 + s.getMinutes(), end: e.getHours() * 60 + e.getMinutes() + Number(b.buffer_min || 0), kind: "booking", label: `${b.resource}${b.purpose ? `, ${b.purpose}` : ""}`, buffer: Number(b.buffer_min || 0) }; }),
    ...evs.map((e) => { const s = new Date(e.start), en = new Date(e.end || e.start); return { start: s.getHours() * 60 + s.getMinutes(), end: en.getHours() * 60 + en.getMinutes(), kind: "event", label: e.title || "busy" }; }),
  ];
  const lo = Math.min(8 * 60, ...items.map((i) => i.start)), hi = Math.max(19 * 60, ...items.map((i) => i.end));
  const pct = (m) => ((m - lo) / (hi - lo)) * 100;
  const clashes = items.filter((i) => i.kind === "event").filter((e) => items.some((b) => b.kind === "maker" && e.start < b.end && b.start < e.end));
  const hours = [];
  for (let h = Math.ceil(lo / 60); h <= Math.floor(hi / 60); h++) hours.push(h);
  return `<section class="td-sec">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap">
      <h3 style="margin:0">${DAYS[new Date().getDay()]}</h3>
      <div class="row tiny muted" style="gap:12px;flex-wrap:wrap">
        <span><i class="key maker"></i>maker time</span><span><i class="key manager"></i>manager time</span>
        <span><i class="key booking"></i>bookings</span><span><i class="key event"></i>calendar</span>
      </div>
    </div>
    ${items.length ? `<div class="strip">
      ${hours.map((h) => `<span class="hr" style="left:${pct(h * 60)}%">${h}</span>`).join("")}
      ${items.map((i) => `<div class="blk ${i.kind}" style="left:${pct(i.start)}%;width:${Math.max(1.5, pct(i.end) - pct(i.start))}%" title="${esc(i.label)}"><span>${esc(i.label)}</span></div>`).join("")}
    </div>` : ""}
    ${clashes.length ? `<p class="small" style="color:var(--amber);margin:8px 0 0">${clashes.length} meeting${clashes.length > 1 ? "s" : ""} cut${clashes.length > 1 ? "" : "s"} into maker time today: ${clashes.map((c) => esc(c.label)).join(", ")}.</p>` : ""}
    ${!blocks.length ? `<p class="small muted" style="margin:8px 0 0">No maker or manager blocks for ${DAYS[new Date().getDay()]} yet. Set your week below, so bench time is protected before the meetings land.</p>` : ""}
    <details class="plan-edit"><summary class="small">Set my week</summary>${planEditor()}</details>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:10px">
      ${CALSTATE === "on" ? `<span class="tiny muted">Showing your Google Calendar.</span>
        ${blocks.filter((b) => b.type === "maker").map((b) => `<button class="ghost sm" data-protect="${b.id}">Hold ${esc(b.start)}–${esc(b.end)} on my calendar</button>`).join("")}
        <span class="tiny muted" id="protect-msg"></span>`
      : `<label class="ghost sm ics-btn">Add my calendar from a .ics file<input type="file" id="ics" accept=".ics,text/calendar" hidden></label>
      <span class="tiny muted">${EVENTS.length ? `${EVENTS.length} events loaded on this device. ` : ""}${CALSTATE === "denied" ? "Benchcraft was not allowed to read your calendar here; allow it from the artifact's permissions menu." : "To see your Google Calendar here, connect it once in claude.ai under Settings, Connectors. It stays on your own account."}</span>
      ${EVENTS.length ? `<button class="link" id="ics-clear">clear</button>` : ""}`}
    </div>
  </section>`;
}

function planEditor() {
  const plans = T.allPlans || [];
  return `<div class="plan-list">${plans.length ? plans.map((p) => `<div class="plan-row">
      <span>${DAYS[p.weekday]}</span><span class="conf">${esc(p.start)}–${esc(p.end)}</span>
      <span class="pill ${p.type === "maker" ? "mk" : ""}">${p.type}</span><span class="small">${esc(p.label || "")}</span>
      <button class="link" data-delplan="${p.id}">remove</button></div>`).join("") : ""}</div>
    <div class="row" style="flex-wrap:wrap;margin-top:8px">
      <select id="pl-day" style="width:auto">${DAYS.map((d, i) => `<option value="${i}" ${i === new Date().getDay() ? "selected" : ""}>${d}</option>`).join("")}</select>
      <input id="pl-start" type="time" value="09:00" style="width:auto"><input id="pl-end" type="time" value="13:00" style="width:auto">
      <select id="pl-type" style="width:auto"><option value="maker">maker</option><option value="manager">manager</option></select>
      <input id="pl-label" placeholder="label, optional" style="flex:1;min-width:120px">
      <button class="ghost sm" id="pl-add">Add</button>
      <button class="link" id="pl-week">copy to every weekday</button>
    </div>
    <p class="tiny muted" style="margin-top:6px">A maker morning and a manager afternoon is a common split: one long stretch for the bench or analysis, meetings batched after.</p>`;
}

// What the work is for. Ends get revisited too, not only the means to them.
function purposeBox() {
  const p = T.purpose;
  const stale = p && (Date.now() - Date.parse(p.created_at)) > 30 * 86400000;
  return `<div class="purpose">
    <div class="sub-h" style="margin-top:0">What this work is for</div>
    ${p ? `<div class="ptext">${esc(p.text)}</div><div class="tiny muted">written ${esc(p.created_at.slice(0, 10))}${stale ? `. A month on: is it still what matters, or has the work shown you something else?` : ""}</div>` : `<div class="small muted">A sentence or two on what you are trying to find out, and why it matters to you. You can revise it as the work changes your mind.</div>`}
    <details style="margin-top:6px" ${p ? "" : "open"}><summary class="tiny">${p ? "Revise it" : "Write it"}</summary>
      <textarea id="pp-text" rows="2" style="margin-top:6px">${esc(p ? p.text : "")}</textarea>
      ${p ? `<input id="pp-why" placeholder="what changed your mind, if anything" style="margin-top:5px">` : ""}
      <button class="ghost sm" id="pp-save" style="margin-top:6px">Save</button></details>
  </div>`;
}

// The things you said you wanted to get better at, each with one honest number from the record.
const GOAL_LABEL = { confounders: "Spotting confounders", calibration: "Knowing how sure to be", record: "A record someone could follow", weighing: "Weighing advice on its reasons", writing: "Turning work into writing" };
function goalsBox() {
  const goals = (T.profile && T.profile.goals) || [];
  if (!goals.length) return "";
  const r = T.record, j = T.judgment, c = T.calibration;
  const reasonedPct = j.weighed ? Math.round(100 * (j.moved_reasoned + j.not_reasoned + j.unsure) / j.weighed) : null;
  const line = {
    confounders: `${r.missing_controls_flagged} missing control${r.missing_controls_flagged === 1 ? "" : "s"} raised across your second opinions`,
    calibration: c.brier_score != null ? `Brier ${c.brier_score} over ${c.resolved_n} outcome${c.resolved_n === 1 ? "" : "s"}; ${c.tracked_confidence_n} readings with a stated confidence` : `${c.tracked_confidence_n} readings with a stated confidence, none resolved yet`,
    record: `${r.with_reading} of ${r.entries} entries have a reading, ${r.resolved} an outcome, ${r.with_data} data or figures`,
    weighing: reasonedPct != null ? `${reasonedPct}% of what you weighed came with a reason` : "nothing weighed yet",
    writing: "briefs and slides come from the record above, so a fuller record makes them better",
  };
  return `<div class="goals-row">${goals.map((g) => `<div class="goal"><div class="sub-h" style="margin:0">${esc(GOAL_LABEL[g] || g)}</div><div class="small">${esc(line[g] || "")}</div></div>`).join("")}</div>`;
}

function sourcesTable(src) {
  const rows = Object.entries(src || {}).filter(([, t]) => t.weighed || t.unweighed);
  if (!rows.length) return "";
  return `<table class="srcs"><tr><th>from</th><th>weighed</th><th>with a reason</th><th>moved you</th></tr>${rows.map(([k, t]) => `<tr>
    <td>${esc(k)}</td><td>${t.weighed}${t.unweighed ? ` <span class="tiny muted">(+${t.unweighed} not yet)</span>` : ""}</td>
    <td>${t.weighed ? Math.round(100 * t.reasoned / t.weighed) + "%" : ""}</td><td>${t.weighed ? Math.round(100 * t.moved / t.weighed) + "%" : ""}</td></tr>`).join("")}</table>`;
}

function card(title, body, foot = "") {
  return `<section class="td-sec card-like"><h3>${title}</h3>${body}${foot}</section>`;
}

function draw() {
  const t = T;
  const j = t.judgment, c = t.calibration;
  ROOT.innerHTML = `<div class="td-wrap today">
    <h2 class="td-h">Today</h2>
    ${purposeBox()}
    ${goalsBox()}
    ${dayStrip()}
    <div class="today-grid">
      ${card("Next experiments you wrote", t.next.length ? t.next.map((n) => `<div class="tl">
        <button class="link tl-t" data-exp="${n.experiment_id}">${esc(n.title)}</button>
        <div class="small">${esc(n.step)}</div><div class="tiny muted">from your reading on ${esc(n.since)}</div></div>`).join("")
        : `<p class="small muted">When a reading names a next experiment, it waits here until you start it.</p>`)}
      ${card("In progress", t.in_progress.length || t.due.length ? `${t.in_progress.map((x) => `<div class="tl small">${x.icon ? esc(x.icon) + " " : ""}${esc(x.title)}</div>`).join("")}
        ${t.due.length ? `<div class="sub-h">Due this week</div>${t.due.map((x) => `<div class="tl small">${esc(x.title)} <span class="tiny muted">${esc(x.due)}</span></div>`).join("")}` : ""}`
        : `<p class="small muted">Nothing marked in progress on the to-do list.</p>`)}
      ${card("Waiting on how it turned out", t.waiting.length ? t.waiting.map((w) => `<div class="tl">
        <button class="link tl-t" data-exp="${w.experiment_id}">${esc(w.title)}</button>
        <div class="tiny muted">reading from ${esc(w.since)}${w.confidence != null ? `, you said ${w.confidence}/100` : ""}</div></div>`).join("")
        : `<p class="small muted">No open readings older than three days.</p>`)}
      ${card("Running low", t.low_reagents.length || t.short_lines.length ? `${t.low_reagents.map((r) => `<div class="tl small"><strong>${esc(r.name)}</strong> ${r.status === "out" ? "is out" : `${r.amount_left}${esc(r.unit || "")} left`}</div>`).join("")}
        ${t.short_lines.map((l) => `<div class="tl small"><strong>${esc(l.name)}</strong> ${l.vials_left} vial${l.vials_left === 1 ? "" : "s"}, below ${l.min_vials}
          <button class="link" data-alert="${l.id}">draft a note to the lab manager</button></div>`).join("")}
        <div class="err tiny" id="alert-err"></div>` : `<p class="small muted">Stock and vials are above their marks.</p>`)}
      ${card("Lab admin", t.trainings.length || t.rota.length || t.approvals.length || t.checklists.length ? `
        ${t.checklists.map((k) => `<div class="tl small">${k.done_today ? "&#10003;" : "&#9675;"} ${esc(k.name)}${k.done_today ? " done today" : ""}</div>`).join("")}
        ${t.trainings.map((x) => `<div class="tl small">${esc(x.name)} <span class="tiny muted">${x.status === "done" ? `expires ${esc(x.expires)}` : esc(x.status || "to do")}</span></div>`).join("")}
        ${t.rota.map((x) => `<div class="tl small">${esc(x.task)} <span class="tiny muted">${esc(x.who || "")} ${esc(x.due)}</span></div>`).join("")}
        ${t.approvals.map((x) => `<div class="tl small">Approval: ${esc(x.what)} <span class="tiny muted">${esc(x.status || "pending")}</span></div>`).join("")}`
        : `<p class="small muted">Inductions, sign-offs, rotas and approvals show up here once you add them under Lab.</p>`,
        `<button class="ghost sm" data-tool="lab" style="margin-top:10px">Open Lab</button>`)}
      ${card("Bookings this week", t.bookings.length ? t.bookings.map((b) => `<div class="tl small"><strong>${esc(b.resource)}</strong>
        ${new Date(b.start).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} ${hm(b.start)}–${hm(b.end)}${Number(b.buffer_min) ? `, then ${b.buffer_min} min UV or cleaning` : ""}${b.purpose ? `<div class="tiny muted">${esc(b.purpose)}</div>` : ""}</div>`).join("")
        : `<p class="small muted">No hoods, rooms or instruments booked.</p>`, `<button class="ghost sm" data-tool="lab-bookings" style="margin-top:10px">Book something</button>`)}
      ${card("Surprises", j.surprises.length ? j.surprises.map((x) => `<div class="tl"><button class="link tl-t" data-exp="${x.experiment_id}">${esc(x.title)}</button>
        <div class="small">${esc(x.text)}</div><div class="tiny muted">${esc(x.date)}</div></div>`).join("")
        + `<div class="tiny muted" style="margin-top:6px">${j.revised_entries ? `${j.revised_entries} entr${j.revised_entries === 1 ? "y has" : "ies have"} more than one reading: your view moved.` : ""}</div>`
        : `<p class="small muted">When a run goes against what you expected, note it in your reading. Those are the runs that teach the most.</p>`)}
      ${card("How you weigh advice", j.weighed || Object.keys(j.sources || {}).length ? `${sourcesTable(j.sources)}`
        + (j.weighed ? `<div class="jbar" style="margin-top:10px">${[["moved_reasoned", "moved, with a reason"], ["not_reasoned", "not moved, with a reason"], ["moved_unreasoned", "moved, no reason"], ["not_unreasoned", "not moved, no reason"], ["unsure", "unsure"]].map(([k, l]) => j[k] ? `<span class="jseg ${k}" style="flex:${j[k]}" title="${l}: ${j[k]}"></span>` : "").join("")}</div>` : "")
        + `<div class="tiny muted" style="margin-top:6px">Neither taking advice nor refusing it shows judgment by itself. The reasons do, whoever the advice came from.</div>`
        + (c.brier_score != null ? `<div class="tiny muted" style="margin-top:6px">Calibration: Brier ${c.brier_score} over ${c.resolved_n} outcome${c.resolved_n === 1 ? "" : "s"}.</div>` : "")
        : `<p class="small muted">Log advice on an entry, from anyone, and weigh it. This shows whether your reasons hold up evenly across sources.</p>`)}
    </div>
  </div>`;
  wire();
}

function wire() {
  ROOT.querySelectorAll("[data-exp]").forEach((b) => b.onclick = () => OPEN_EXP(+b.dataset.exp));
  ROOT.querySelectorAll("[data-tool]").forEach((b) => b.onclick = () => OPEN_TOOL(b.dataset.tool));
  ROOT.querySelectorAll("[data-alert]").forEach((b) => b.onclick = async () => {
    b.textContent = "drafting…";
    try {
      const out = await B.api(`/lines/${b.dataset.alert}/alert_draft`, "POST");
      b.outerHTML = out.url ? `<a href="${esc(out.url)}" target="_blank" rel="noopener">draft ready in Gmail, check and send it</a>` : `<span class="tiny">draft saved in Gmail for ${esc(out.to)}</span>`;
    } catch (e) { b.textContent = "draft a note to the lab manager"; $("#alert-err").textContent = e.message; }
  });
  const pp = $("#pp-save");
  if (pp) pp.onclick = async () => {
    try { await B.api(`/projects/${PID}/purpose`, "POST", { text: $("#pp-text").value, why_changed: $("#pp-why") ? $("#pp-why").value : "" }); T = await B.api(`/projects/${PID}/today`); draw(); }
    catch (e) { pp.insertAdjacentHTML("afterend", `<span class="err tiny"> ${esc(e.message)}</span>`); }
  };
  ROOT.querySelectorAll("[data-protect]").forEach((b) => b.onclick = async () => {
    const blk = T.blocks.find((x) => x.id === +b.dataset.protect);
    const d = new Date(), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    b.disabled = true;
    try {
      const out = await B.api("/calendar/protect", "POST", { date, start: blk.start, end: blk.end, label: blk.label || "Bench time" });
      $("#protect-msg").innerHTML = out.link ? `<a href="${esc(out.link)}" target="_blank" rel="noopener">on your calendar</a>` : "on your calendar";
      CALEV = await B.api("/calendar/day"); draw();
    } catch (e) { b.disabled = false; $("#protect-msg").textContent = e.message; }
  });
  const ics = $("#ics");
  if (ics) ics.onchange = async () => {
    const f = ics.files[0];
    if (!f) return;
    EVENTS = parseIcs(await f.text()).filter((e) => Date.parse(e.end || e.start) > Date.now() - 86400000 && Date.parse(e.start) < Date.now() + 60 * 86400000);
    try { localStorage.setItem("bc.icsEvents", JSON.stringify(EVENTS)); } catch { /* storage blocked */ }
    draw();
  };
  const clr = $("#ics-clear");
  if (clr) clr.onclick = () => { EVENTS = []; try { localStorage.removeItem("bc.icsEvents"); } catch { /* storage blocked */ } draw(); };
  const add = async (days) => {
    for (const d of days) await B.api(`/projects/${PID}/plans`, "POST", { weekday: d, start: $("#pl-start").value, end: $("#pl-end").value, type: $("#pl-type").value, label: $("#pl-label").value });
    T = await B.api(`/projects/${PID}/today`); draw();
    const det = ROOT.querySelector(".plan-edit"); if (det) det.open = true;
  };
  const pa = $("#pl-add");
  if (pa) pa.onclick = () => add([Number($("#pl-day").value)]);
  const pw = $("#pl-week");
  if (pw) pw.onclick = () => add([1, 2, 3, 4, 5]);
  ROOT.querySelectorAll("[data-delplan]").forEach((b) => b.onclick = async () => {
    await B.api(`/plans/${b.dataset.delplan}`, "DELETE"); T = await B.api(`/projects/${PID}/today`); draw();
    const det = ROOT.querySelector(".plan-edit"); if (det) det.open = true;
  });
}
