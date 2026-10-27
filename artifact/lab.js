// Lab admin: the records every lab keeps, in one window opened from the bookmarks bar.
import * as B from "./lib/backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);

// Each tab is a list of records plus a form, described once here.
const TABS = {
  trainings: { label: "Training", plural: "trainings", fields: [
    ["name", "What", "text", "Room induction, hood sign-off, microscope training"],
    ["type", "Kind", ["induction", "training", "sign-off", "access"]],
    ["room", "Room or instrument", "text"],
    ["status", "Status", ["to do", "booked", "done"]],
    ["signed_by", "Signed off by", "text"],
    ["date", "Done on", "date"], ["expires", "Renew by", "date"], ["notes", "Notes", "text"]],
    row: (r) => `<strong>${esc(r.name)}</strong> <span class="pill">${esc(r.status || "to do")}</span> ${r.type ? `<span class="tiny muted">${esc(r.type)}</span>` : ""}
      ${r.signed_by ? `<div class="tiny muted">signed off by ${esc(r.signed_by)}${r.date ? ` on ${esc(r.date)}` : ""}</div>` : ""}${r.expires ? `<div class="tiny muted">renew by ${esc(r.expires)}</div>` : ""}` },
  bookings: { label: "Bookings", plural: "bookings", fields: [
    ["resource", "What", "text", "Stem-cell hood 2, meeting room, confocal"],
    ["start", "From", "datetime-local"], ["end", "To", "datetime-local"],
    ["buffer_min", "Then hold for (min)", "number", "UV cycle or cleaning after"],
    ["purpose", "For", "text"]],
    row: (r) => `<strong>${esc(r.resource)}</strong> ${esc(r.start.replace("T", " "))} to ${esc(r.end.slice(11))}${Number(r.buffer_min) ? `, then ${r.buffer_min} min held` : ""}${r.purpose ? `<div class="tiny muted">${esc(r.purpose)}</div>` : ""}` },
  rotas: { label: "Rota", plural: "rotas", fields: [
    ["task", "Duty", "text", "Hood cleaning, weekend feeding, waste"], ["who", "Who", "text"], ["due", "When", "date"],
    ["repeat", "Repeats", ["", "weekly", "fortnightly", "monthly"]]],
    row: (r) => `<label class="row" style="margin:0;font-weight:400"><input type="checkbox" data-done="${r.id}" ${r.done ? "checked" : ""} style="width:auto">
      <span><strong>${esc(r.task)}</strong> ${esc(r.who || "")} <span class="tiny muted">${esc(r.due || "")}${r.repeat ? `, ${esc(r.repeat)}` : ""}</span></span></label>` },
  checklists: { label: "Checks", plural: "checklists", fields: [
    ["name", "Checklist", "text", "Before entering the cell lab"], ["when", "When", "text", "every entry, start of day"],
    ["items", "Items, one per line", "lines"]],
    row: (r) => `<strong>${esc(r.name)}</strong> ${r.when ? `<span class="tiny muted">${esc(r.when)}</span>` : ""}
      <div class="checks">${(r.items || []).map((it, i) => `<label class="row" style="margin:2px 0;font-weight:400"><input type="checkbox" data-ck="${r.id}" data-i="${i}" style="width:auto"> ${esc(it)}</label>`).join("")}</div>
      <button class="ghost sm" data-logck="${r.id}">Done for today</button>` },
  approvals: { label: "Approvals", plural: "approvals", fields: [
    ["what", "What needs approving", "text", "New cell line, out-of-hours access"], ["approver", "Who approves", "text"],
    ["requested_on", "Asked on", "date"], ["status", "Status", ["pending", "approved", "declined"]], ["notes", "Notes", "text"]],
    row: (r) => `<strong>${esc(r.what)}</strong> <span class="pill">${esc(r.status || "pending")}</span>${r.approver ? ` <span class="tiny muted">${esc(r.approver)}</span>` : ""}` },
  contacts: { label: "Contacts", plural: "contacts", fields: [
    ["role", "Role", "text", "lab manager, supervisor, safety officer"], ["name", "Name", "text"], ["email", "Email", "email"]],
    row: (r) => `<strong>${esc(r.role)}</strong> ${esc(r.name || "")} <span class="tiny muted">${esc(r.email || "")}</span>` },
  templates_mine: { label: "My templates", plural: "templates_mine", fields: [
    ["name", "Name", "text", "Matrigel coating, thaw and plate"], ["who", "When to use it", "text"],
    ["protocol", "Steps, one per line", "lines"], ["caution", "Caution shown with it", "text", "Pointer only, follow the lab's current SOP"]],
    row: (r) => `<strong>${esc(r.name)}</strong> <span class="tiny muted">${(r.protocol || []).length} steps</span>${r.caution ? `<div class="tiny" style="color:var(--amber)">${esc(r.caution)}</div>` : ""}` },
};
const ORDER = ["trainings", "bookings", "rotas", "checklists", "approvals", "contacts", "labels", "templates_mine"];

let PID = null, EXP = null, TAB = "trainings", ROWS = [], EDIT = null;

export async function openLab(projectId, exp, tab) {
  PID = projectId; EXP = exp; TAB = tab || TAB; EDIT = null;
  const modal = document.getElementById("modal");
  modal.classList.add("wide");
  await load();
  draw();
  if (!modal.open) modal.showModal();
}

async function load() { ROWS = TAB === "labels" ? [] : await B.api(`/projects/${PID}/${TABS[TAB].plural}`); }

function input([key, label, type, hint], value) {
  const v = value ?? "";
  if (Array.isArray(type)) return `<div><label>${label}</label><select data-f="${key}">${type.map((o) => `<option value="${o}" ${o === v ? "selected" : ""}>${o || "none"}</option>`).join("")}</select></div>`;
  if (type === "lines") return `<div style="grid-column:1/-1"><label>${label}</label><textarea data-f="${key}" rows="4">${esc(Array.isArray(v) ? v.join("\n") : v)}</textarea></div>`;
  return `<div><label>${label}${hint ? ` <span class="hint">${esc(hint)}</span>` : ""}</label><input data-f="${key}" type="${type}" value="${esc(v)}"></div>`;
}

function labels() {
  const line = EXP && (EXP.context || {})["cell line"];
  const passage = EXP && (EXP.context || {}).passage;
  return `<p class="small muted">Text for a plate, vial or waste bottle, ready to copy onto a label printer or write by hand.</p>
    <div class="ctx-row" style="grid-template-columns:repeat(3,1fr)">
      <div><label>Kind</label><select id="lb-kind"><option value="plate">Plate or flask</option><option value="vial">Frozen vial</option><option value="waste">Waste bottle</option></select></div>
      <div><label>Name or initials</label><input id="lb-name"></div>
      <div><label>Date</label><input id="lb-date" type="date" value="${today()}"></div>
      <div><label>Cell line</label><input id="lb-line" value="${esc(line || "")}"></div>
      <div><label>Passage</label><input id="lb-p" value="${esc(passage || "")}"></div>
      <div><label>Coating or medium</label><input id="lb-coat" placeholder="e.g. Matrigel, hESC grade"></div>
      <div style="grid-column:1/-1"><label>For waste: contents and hazards</label><input id="lb-waste" placeholder="e.g. 70% ethanol, flammable"></div>
    </div>
    <pre class="label-out" id="lb-out"></pre>
    <div class="row"><button class="ghost sm" id="lb-copy">Copy</button><span class="tiny muted" id="lb-msg"></span></div>
    <p class="tiny muted">For a reused solvent bottle, cross out the original label before applying a waste label.</p>`;
}

function labelText() {
  const v = (id) => $(id).value.trim();
  const kind = $("#lb-kind").value;
  if (kind === "waste") return ["WASTE", v("#lb-waste") || "contents:", `${v("#lb-name")}  ${v("#lb-date")}`].filter(Boolean).join("\n");
  const top = [v("#lb-line"), v("#lb-p") && `P${v("#lb-p").replace(/^p/i, "")}`].filter(Boolean).join(" ");
  return [top, v("#lb-coat"), `${v("#lb-name")}  ${v("#lb-date")}`].filter(Boolean).join("\n");
}

function draw() {
  const t = TABS[TAB];
  $("#modal-body").innerHTML = `<h2>Lab</h2>
    <div class="chips" style="margin:6px 0 16px">${ORDER.map((k) => `<span class="chip fz-tab ${k === TAB ? "on" : ""}" data-lt="${k}">${k === "labels" ? "Labels" : TABS[k].label}</span>`).join("")}</div>
    ${TAB === "labels" ? labels() : `
      <div class="lab-rows">${ROWS.length ? ROWS.map((r) => `<div class="lab-row">${t.row(r)}
        <span class="lab-acts"><button class="link" data-edit="${r.id}">edit</button><button class="link" data-del="${r.id}">remove</button></span></div>`).join("")
        : `<p class="small muted">Nothing here yet.</p>`}</div>
      <h3 style="margin-top:18px">${EDIT ? "Edit" : "Add"}</h3>
      <div class="ctx-row lab-form" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${t.fields.map((f) => input(f, EDIT ? EDIT[f[0]] : f[2] === "date" && ["requested_on", "due"].includes(f[0]) ? today() : f[0] === "buffer_min" ? 30 : undefined)).join("")}
      </div>
      <div class="row" style="margin-top:10px"><button id="lab-save">${EDIT ? "Save" : "Add"}</button>${EDIT ? `<button class="ghost" id="lab-cancel">Cancel</button>` : ""}</div>`}
    <div class="err" id="lab-err"></div>`;
  wire();
}

async function act(fn) {
  try { await fn(); await load(); EDIT = null; draw(); }
  catch (e) { $("#lab-err").textContent = e.message; }
}

function wire() {
  const body = $("#modal-body");
  body.querySelectorAll("[data-lt]").forEach((c) => c.onclick = async () => { TAB = c.dataset.lt; EDIT = null; await load(); draw(); });
  if (TAB === "labels") {
    const paint = () => { $("#lb-out").textContent = labelText(); };
    body.querySelectorAll("input,select").forEach((el) => el.oninput = paint);
    paint();
    $("#lb-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(labelText()); $("#lb-msg").textContent = "copied"; }
      catch { $("#lb-msg").textContent = "copy did not work here; select the text by hand"; }
    };
    return;
  }
  const t = TABS[TAB];
  const read = () => Object.fromEntries(t.fields.map(([k, , type]) => {
    const el = body.querySelector(`[data-f="${k}"]`);
    const v = el.value;
    return [k, type === "lines" ? v.split("\n").map((x) => x.trim()).filter(Boolean) : type === "number" ? (v === "" ? null : Number(v)) : v];
  }));
  $("#lab-save").onclick = () => act(() => EDIT ? B.api(`/${t.plural}/${EDIT.id}`, "PUT", read()) : B.api(`/projects/${PID}/${t.plural}`, "POST", read()));
  const cancel = $("#lab-cancel");
  if (cancel) cancel.onclick = () => { EDIT = null; draw(); };
  body.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { EDIT = ROWS.find((r) => r.id === +b.dataset.edit); draw(); });
  body.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "click again"; return; }
    act(() => B.api(`/${t.plural}/${b.dataset.del}`, "DELETE"));
  });
  body.querySelectorAll("[data-done]").forEach((cb) => cb.onchange = () => act(async () => {
    const r = ROWS.find((x) => x.id === +cb.dataset.done);
    await B.api(`/rotas/${r.id}`, "PUT", { done: cb.checked });
    const step = { weekly: 7, fortnightly: 14, monthly: 30 }[r.repeat];
    if (cb.checked && step && r.due) {
      const next = new Date(Date.parse(r.due) + step * 86400000).toISOString().slice(0, 10);
      await B.api(`/projects/${PID}/rotas`, "POST", { task: r.task, who: r.who, due: next, repeat: r.repeat });
    }
  }));
  body.querySelectorAll("[data-logck]").forEach((b) => b.onclick = () => act(async () => {
    const id = +b.dataset.logck;
    const done = [...body.querySelectorAll(`[data-ck="${id}"]`)].filter((x) => x.checked).map((x) => +x.dataset.i);
    await B.api(`/projects/${PID}/check_logs`, "POST", { checklist_id: id, date: today(), done });
  }));
}
