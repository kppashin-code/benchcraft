// The to-do tab: one list, seen as a board, a toggle list or a table, with notes underneath.
import * as B from "./lib/backend.js";

const COLS = [
  ["general", "General"],
  ["progress", "In progress"],
  ["done", "Completed"],
];
const ICON = {
  doc: `<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5M6 8.2h4.5M6 10.8h3.5"/>`,
  pen: `<path d="M3 13l1-3.2L11 2.8l2.2 2.2-7 7z"/><path d="M2.5 14.5h11"/>`,
  dots: `<circle cx="3.5" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor"/>`,
  star: `<path d="M8 2l1.8 3.8 4.1.5-3 2.8.8 4.1L8 11.2 4.3 13.2l.8-4.1-3-2.8 4.1-.5z"/>`,
  smile: `<circle cx="8" cy="8" r="6"/><path d="M5.6 9.6c1.3 1.4 3.5 1.4 4.8 0"/><path d="M6 6.3h.01M10 6.3h.01"/>`,
  list: `<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>`,
  open: `<path d="M5 3h8v8"/><path d="M13 3L3.5 12.5"/>`,
  link: `<path d="M6.5 9.5l3-3"/><path d="M7.3 4.6l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L11 8.3M8.7 11.4l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5 7.7"/>`,
  copy: `<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7"/>`,
  dup: `<rect x="2.5" y="4.5" width="8" height="9" rx="1.5"/><path d="M5.5 2.5h6.5a1.5 1.5 0 0 1 1.5 1.5v7"/>`,
  move: `<path d="M2.5 8h10"/><path d="M9 4.5L12.5 8 9 11.5"/>`,
  trash: `<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.5h6.8L12 4"/>`,
  back: `<path d="M6 4.5L2.5 8 6 11.5"/><path d="M2.5 8h7a4 4 0 0 1 4 4"/>`,
};
const svg = (n) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const EMOJI = ["🧪", "🧫", "🔬", "🧬", "🧊", "🧯", "📄", "📊", "📝", "📚", "✉️", "📅", "✈️", "🧳", "🏠", "💡", "⭐", "🎓", "💸", "🎨", "🎵", "🏃", "☕", "🌱"];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (s, root = document) => root.querySelector(s);

let TODOS = [], EXPS = [], NOTES = { body: "" }, VIEW = "board", OPEN = new Set(["col:trash"]), ROOT = null, ON_OPEN_EXP = null;
let MENU = null, EDITING = null;
try { VIEW = localStorage.getItem("bc.todoView") || "board"; } catch { /* storage blocked */ }

export async function showTodos(root, projectId, onOpenExperiment) {
  ROOT = root; ON_OPEN_EXP = onOpenExperiment;
  [TODOS, EXPS, NOTES] = await Promise.all([B.api("/todos"), B.api(`/projects/${projectId}/experiments`), B.api("/todo_notes")]);
  draw();
}

const save = async (id, fields) => { TODOS = await B.api(`/todos/${id}`, "PUT", fields); };
const create = async (fields) => { TODOS = await B.api("/todos", "POST", fields); };
const remove = async (id) => { TODOS = await B.api(`/todos/${id}`, "DELETE"); };
const live = () => TODOS.filter((t) => !t.trashed_at);
const inCol = (st) => live().filter((t) => t.status === st);
const byId = (id) => TODOS.find((t) => t.id === id);
const expTitle = (id) => (EXPS.find((e) => e.id === id) || {}).title || "";
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), today = new Date();
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? `Today at ${t}` : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${t}`;
};

function lead(t) {
  if (t.icon) return `<span class="td-emoji">${esc(t.icon)}</span>`;
  return t.body ? `<span class="td-doc">${svg("doc")}</span>` : "";
}

function cardTitle(t) {
  if (t.kind_of === "divider") return `<span class="td-div">${esc(t.title) || "&nbsp;"}</span>`;
  const name = EDITING === t.id
    ? `<input class="td-rename" data-rename="${t.id}" value="${esc(t.title)}" aria-label="Task name">`
    : `<span>${esc(t.title) || '<span class="muted">Untitled</span>'}</span>`;
  return `${lead(t)}${name}${t.favorite ? `<span class="td-fav" title="Favourite">${svg("star")}</span>` : ""}`;
}

function meta(t) {
  const bits = [];
  if (t.due) bits.push(`due ${esc(t.due)}`);
  if (t.experiment_id && expTitle(t.experiment_id)) bits.push(esc(expTitle(t.experiment_id)));
  return bits.length ? `<div class="td-meta">${bits.join(" · ")}</div>` : "";
}

const tools = (t) => `<div class="td-tools">
  ${t.kind_of === "divider" ? "" : `<button class="td-tool" data-edit="${t.id}" title="Edit" aria-label="Rename">${svg("pen")}</button>`}
  <button class="td-tool" data-menu="${t.id}" title="More" aria-label="More actions">${svg("dots")}</button></div>`;

function board() {
  return `<div class="td-board">${COLS.map(([st, label]) => `
    <section class="td-col ${st}" data-col="${st}">
      <header><span class="td-pill">${label}</span><span class="td-n">${inCol(st).filter((t) => t.kind_of !== "divider").length}</span></header>
      <div class="td-cards">${inCol(st).map((t) => `
        <div class="td-card${t.kind_of === "divider" ? " divider" : ""}" draggable="${EDITING !== t.id}" data-id="${t.id}" tabindex="0">
          <div class="td-t">${cardTitle(t)}</div>${meta(t)}${tools(t)}
        </div>`).join("")}</div>
      <div class="td-add"><button class="td-new" data-new="${st}">+ New task</button><button class="link td-newdiv" data-newdiv="${st}">divider</button></div>
    </section>`).join("")}</div>`;
}

function everything() {
  const trashed = TODOS.filter((t) => t.trashed_at);
  const group = (st, label) => {
    const open = !OPEN.has("col:" + st);
    return `<div class="td-group ${st}">
      <button class="td-tog" data-tog="col:${st}" aria-expanded="${open}"><span class="tri">${open ? "▾" : "▸"}</span><span class="td-pill">${label}</span><span class="td-n">${inCol(st).filter((t) => t.kind_of !== "divider").length}</span></button>
      ${open ? `<div class="td-items">${inCol(st).map((t) => {
        if (t.kind_of === "divider") return `<div class="td-row divider" data-id="${t.id}">${cardTitle(t)}${tools(t)}</div>`;
        const o = OPEN.has(t.id);
        return `<div class="td-row" data-id="${t.id}">
          <div class="td-line">
            <button class="td-tog sm" data-tog="${t.id}" aria-expanded="${o}" aria-label="Show notes"><span class="tri">${o ? "▾" : "▸"}</span></button>
            <input type="checkbox" data-done="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Done">
            ${lead(t)}<span class="td-name ${t.status === "done" ? "struck" : ""}" data-open="${t.id}">${esc(t.title) || "Untitled"}</span>${meta(t)}${tools(t)}
          </div>
          ${o ? `<textarea class="td-body" data-body="${t.id}" rows="3" placeholder="Notes, links, sub-steps">${esc(t.body)}</textarea>` : ""}
        </div>`;
      }).join("")}
      <button class="td-new inline" data-new="${st}">+ New task</button></div>` : ""}
    </div>`;
  };
  const trashOpen = !OPEN.has("col:trash");
  return `<div class="td-toggles">${COLS.map(([st, l]) => group(st, l)).join("")}
    ${trashed.length ? `<div class="td-group trash">
      <button class="td-tog" data-tog="col:trash" aria-expanded="${trashOpen}"><span class="tri">${trashOpen ? "▾" : "▸"}</span><span class="td-pill">Trash</span><span class="td-n">${trashed.length}</span></button>
      ${trashOpen ? `<div class="td-items">${trashed.map((t) => `<div class="td-row"><div class="td-line">
        <span class="td-name struck">${esc(t.title) || "Untitled"}</span>
        <button class="link" data-restore="${t.id}">restore</button><button class="link" data-purge="${t.id}">delete for good</button>
      </div></div>`).join("")}</div>` : ""}</div>` : ""}
  </div>`;
}

function table() {
  const opts = (sel) => COLS.map(([st, l]) => `<option value="${st}" ${st === sel ? "selected" : ""}>${l}</option>`).join("");
  const expOpts = (sel) => `<option value="">none</option>` + EXPS.map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.title)}</option>`).join("");
  return `<div class="dscroll"><table class="td-table">
    <tr><th>Name</th><th>Status</th><th>Due</th><th>Linked entry</th><th></th></tr>
    ${live().filter((t) => t.kind_of !== "divider").map((t) => `<tr data-id="${t.id}">
      <td><div class="td-cell">${lead(t)}<input data-f="title" data-id="${t.id}" value="${esc(t.title)}" aria-label="Name"></div></td>
      <td><select data-f="status" data-id="${t.id}" aria-label="Status">${opts(t.status)}</select></td>
      <td><input type="date" data-f="due" data-id="${t.id}" value="${esc(t.due)}" aria-label="Due"></td>
      <td><select data-f="experiment_id" data-id="${t.id}" aria-label="Linked entry">${expOpts(t.experiment_id)}</select></td>
      <td><button class="td-tool" data-menu="${t.id}" aria-label="More actions">${svg("dots")}</button></td>
    </tr>`).join("")}
  </table></div>
  <button class="td-new inline" data-new="general" style="margin-top:10px">+ New task</button>`;
}

function favourites() {
  const favs = live().filter((t) => t.favorite);
  if (!favs.length) return "";
  return `<div class="td-favs"><span class="td-favlabel">${svg("star")} Favourites</span>${favs.map((t) =>
    `<button class="td-chip" data-open="${t.id}">${t.icon ? esc(t.icon) + " " : ""}${esc(t.title) || "Untitled"}</button>`).join("")}</div>`;
}

function draw() {
  const views = [["board", "Board view"], ["everything", "Everything"], ["table", "Table"]];
  ROOT.innerHTML = `<div class="td-wrap">
    <h2 class="td-h">To-do list</h2>
    ${favourites()}
    <div class="td-views" role="tablist">${views.map(([v, l]) => `<button role="tab" aria-selected="${VIEW === v}" class="td-view ${VIEW === v ? "on" : ""}" data-view="${v}">${l}</button>`).join("")}</div>
    <div id="td-body">${VIEW === "board" ? board() : VIEW === "table" ? table() : everything()}</div>
    <section class="td-notes">
      <h3>Notes</h3>
      <textarea id="td-notes" rows="8" placeholder="Anything that isn't a task: plans for the week, things to remember, who to email.">${esc(NOTES.body)}</textarea>
      <div class="tiny muted" id="td-notes-saved">${NOTES.updated_at ? `Saved ${when(NOTES.updated_at)}` : ""}</div>
    </section>
  </div>`;
  wire();
  const r = $("[data-rename]", ROOT);
  if (r) { r.focus(); r.select(); }
}

// ---------- the actions menu ----------

function closeMenu() { if (MENU) { MENU.remove(); MENU = null; document.removeEventListener("pointerdown", outside, true); } }
function outside(e) { if (MENU && !MENU.contains(e.target)) closeMenu(); }

function menuItems(t) {
  const items = [
    { group: "Task", icon: "star", label: t.favorite ? "Remove from favourites" : "Add to favourites", run: () => save(t.id, { favorite: !t.favorite }) },
    { icon: "smile", label: "Edit icon", sub: "icon" },
    { icon: "list", label: "Edit property", sub: "props" },
    { sep: true },
    { icon: "open", label: "Open", run: () => openPage(t.id), keep: true },
    ...(t.experiment_id ? [{ icon: "link", label: "Open linked entry", run: () => ON_OPEN_EXP(t.experiment_id), keep: true }] : []),
    { icon: "copy", label: "Copy text", run: async () => { try { await navigator.clipboard.writeText([t.title, t.body].filter(Boolean).join("\n\n")); } catch { /* clipboard refused */ } } },
    { sep: true },
    { icon: "dup", label: "Duplicate", hint: "⌘D", run: () => duplicate(t) },
    { icon: "move", label: "Move to", sub: "move" },
    { icon: "trash", label: "Move to trash", hint: "Del", run: () => save(t.id, { trashed: true }) },
  ];
  return items.filter((i) => !(t.kind_of === "divider" && ["Edit icon", "Open", "Copy text"].includes(i.label)));
}

const duplicate = (t) => create({ title: t.title + (t.kind_of === "divider" ? "" : " (copy)"), body: t.body, due: t.due, icon: t.icon, kind_of: t.kind_of, status: t.status, experiment_id: t.experiment_id, position: t.position + 0.001 });

function openMenu(id, anchor) {
  closeMenu();
  const t = byId(id);
  if (!t) return;
  MENU = document.createElement("div");
  MENU.className = "td-menu";
  MENU.setAttribute("role", "menu");
  document.body.appendChild(MENU);
  const words = [t.title, t.body].join(" ").trim().split(/\s+/).filter(Boolean).length;
  const chars = (t.title + t.body).length;
  const drawMain = (q = "") => {
    const items = menuItems(t).filter((i) => i.sep || !q || i.label.toLowerCase().includes(q.toLowerCase()));
    MENU.innerHTML = `<input class="td-search" placeholder="Search actions…" value="${esc(q)}" aria-label="Search actions">
      <div class="td-mgroup">Task</div>
      ${items.map((i, n) => i.sep ? (q ? "" : `<hr>`) : `<button class="td-mi" role="menuitem" data-i="${n}">${svg(i.icon)}<span>${esc(i.label)}</span>${i.sub ? `<span class="td-hint">›</span>` : i.hint ? `<span class="td-hint">${i.hint}</span>` : ""}</button>`).join("")}
      <div class="td-foot">Last edited by you<br>${esc(when(t.updated_at || t.created_at))}<br>${words} word${words === 1 ? "" : "s"}, ${chars} character${chars === 1 ? "" : "s"}</div>`;
    const s = $(".td-search", MENU);
    s.oninput = () => { const pos = s.selectionStart; drawMain(s.value); const n = $(".td-search", MENU); n.focus(); n.setSelectionRange(pos, pos); };
    s.onkeydown = (e) => {
      if (e.key === "Escape") closeMenu();
      if (e.key === "Enter") { const first = $(".td-mi", MENU); if (first) first.click(); }
    };
    MENU.querySelectorAll("[data-i]").forEach((b) => b.onclick = async () => {
      const it = items[+b.dataset.i];
      if (it.sub === "icon") return drawIcons();
      if (it.sub === "props") return drawProps();
      if (it.sub === "move") return drawMove();
      closeMenu();
      await it.run();
      if (!it.keep) draw();
    });
    s.focus();
  };
  const back = `<button class="td-mi" data-back>${svg("back")}<span>Back</span></button><hr>`;
  const wireBack = () => { const b = $("[data-back]", MENU); if (b) b.onclick = () => drawMain(); };
  const drawIcons = () => {
    MENU.innerHTML = `${back}<div class="td-emojis">${EMOJI.map((e) => `<button class="td-em" data-em="${e}" aria-label="${e}">${e}</button>`).join("")}</div>
      ${t.icon ? `<button class="td-mi" data-em="">${svg("trash")}<span>Remove icon</span></button>` : ""}`;
    wireBack();
    MENU.querySelectorAll("[data-em]").forEach((b) => b.onclick = async () => { closeMenu(); await save(t.id, { icon: b.dataset.em }); draw(); });
  };
  const drawMove = () => {
    MENU.innerHTML = `${back}${COLS.map(([st, l]) => `<button class="td-mi" data-st="${st}" ${st === t.status ? "aria-current=\"true\"" : ""}>${svg("move")}<span>${l}</span>${st === t.status ? `<span class="td-hint">here</span>` : ""}</button>`).join("")}`;
    wireBack();
    MENU.querySelectorAll("[data-st]").forEach((b) => b.onclick = async () => {
      closeMenu();
      const last = inCol(b.dataset.st).filter((x) => x.id !== t.id).pop();
      await save(t.id, { status: b.dataset.st, position: (last ? last.position : 0) + 1 });
      draw();
    });
  };
  const drawProps = () => {
    MENU.innerHTML = `${back}
      <label class="td-plabel">Status<select id="mp-status">${COLS.map(([st, l]) => `<option value="${st}" ${st === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${t.kind_of === "divider" ? "" : `<label class="td-plabel">Due<input type="date" id="mp-due" value="${esc(t.due)}"></label>
      <label class="td-plabel">Linked entry<select id="mp-exp"><option value="">none</option>${EXPS.map((e) => `<option value="${e.id}" ${e.id === t.experiment_id ? "selected" : ""}>${esc(e.title)}</option>`).join("")}</select></label>`}
      <button class="td-mi" id="mp-save"><span>Save</span></button>`;
    wireBack();
    $("#mp-save", MENU).onclick = async () => {
      const f = { status: $("#mp-status", MENU).value };
      if ($("#mp-due", MENU)) { f.due = $("#mp-due", MENU).value; f.experiment_id = $("#mp-exp", MENU).value || null; }
      closeMenu(); await save(t.id, f); draw();
    };
  };
  drawMain();
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const w = 280;
  MENU.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - 24))}px`;
  MENU.style.top = `${Math.max(8, Math.min(window.innerHeight - MENU.offsetHeight - 8, r.bottom + 6))}px`;
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
}

// ---------- the task page ----------

function openPage(id) {
  const t = byId(id);
  if (!t) return;
  const modal = document.getElementById("modal");
  modal.classList.remove("wide");
  $("#modal-body").innerHTML = `
    <div class="row" style="align-items:center">${t.icon ? `<span style="font-size:26px">${esc(t.icon)}</span>` : ""}
      <input id="tp-title" class="td-ptitle" value="${esc(t.title)}" placeholder="Untitled" aria-label="Title"></div>
    <div class="ctx-row" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px">
      <div><label>Status</label><select id="tp-status">${COLS.map(([st, l]) => `<option value="${st}" ${st === t.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label>Due</label><input id="tp-due" type="date" value="${esc(t.due)}"></div>
      <div><label>Linked entry</label><select id="tp-exp"><option value="">none</option>${EXPS.map((e) => `<option value="${e.id}" ${e.id === t.experiment_id ? "selected" : ""}>${esc(e.title)}</option>`).join("")}</select></div>
    </div>
    <label>Notes</label><textarea id="tp-body" rows="10" placeholder="Steps, links, who to ask">${esc(t.body)}</textarea>
    <div class="row" style="margin-top:14px">
      <button id="tp-save">Save</button>
      ${t.experiment_id ? `<button class="ghost" id="tp-go">Open the entry</button>` : ""}
      <span style="flex:1"></span>
      <button class="ghost" id="tp-del">Move to trash</button>
    </div>`;
  modal.showModal();
  $("#tp-save").onclick = async () => {
    await save(id, { title: $("#tp-title").value.trim(), status: $("#tp-status").value, due: $("#tp-due").value, experiment_id: $("#tp-exp").value || null, body: $("#tp-body").value });
    modal.close(); draw();
  };
  const go = $("#tp-go");
  if (go) go.onclick = () => { modal.close(); ON_OPEN_EXP(t.experiment_id); };
  $("#tp-del").onclick = async () => { await save(id, { trashed: true }); modal.close(); draw(); };
}

async function newInline(st, divider) {
  const host = ROOT.querySelector(`[data-new="${st}"]`);
  const input = document.createElement("input");
  input.className = "td-input";
  input.placeholder = divider ? "Divider label, like TUESDAY" : "Name the task, then press Enter";
  host.replaceWith(input);
  input.focus();
  let done = false;
  const commit = async (again) => {
    if (done) return; done = true;
    const title = input.value.trim();
    if (title || divider) await create({ title, status: st, kind_of: divider ? "divider" : "task" });
    draw();
    if (again && title && !divider) newInline(st, false);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") commit(true); if (e.key === "Escape") { done = true; draw(); } };
  input.onblur = () => commit(false);
}

let notesTimer = null;

function wire() {
  ROOT.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => {
    VIEW = b.dataset.view;
    try { localStorage.setItem("bc.todoView", VIEW); } catch { /* storage blocked */ }
    draw();
  });
  ROOT.querySelectorAll("[data-new]").forEach((b) => b.onclick = () => newInline(b.dataset.new, false));
  ROOT.querySelectorAll("[data-newdiv]").forEach((b) => b.onclick = () => newInline(b.dataset.newdiv, true));
  ROOT.querySelectorAll(".td-card").forEach((c) => {
    c.onclick = (e) => { if (!e.target.closest(".td-tools, .td-rename") && !c.classList.contains("divider")) openPage(+c.dataset.id); };
    c.onkeydown = async (e) => {
      if (e.target !== c) return;
      const id = +c.dataset.id;
      if (e.key === "Enter" && !c.classList.contains("divider")) openPage(id);
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); await save(id, { trashed: true }); draw(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") { e.preventDefault(); await duplicate(byId(id)); draw(); }
    };
  });
  ROOT.querySelectorAll(".td-card, .td-row[data-id], tr[data-id]").forEach((c) => c.oncontextmenu = (e) => {
    e.preventDefault(); openMenu(+c.dataset.id, { x: e.clientX, y: e.clientY });
  });
  ROOT.querySelectorAll("[data-menu]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); openMenu(+b.dataset.menu, b); });
  ROOT.querySelectorAll("[data-edit]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); EDITING = +b.dataset.edit; draw(); });
  const rn = $("[data-rename]", ROOT);
  if (rn) {
    let done = false;
    const commit = async (keep) => {
      if (done) return; done = true;
      EDITING = null;
      if (keep) await save(+rn.dataset.rename, { title: rn.value.trim() });
      draw();
    };
    rn.onkeydown = (e) => { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); };
    rn.onblur = () => commit(true);
    rn.onclick = (e) => e.stopPropagation();
  }
  ROOT.querySelectorAll("[data-open]").forEach((el) => el.onclick = () => openPage(+el.dataset.open));
  ROOT.querySelectorAll("[data-tog]").forEach((b) => b.onclick = () => {
    const k = /^\d+$/.test(b.dataset.tog) ? +b.dataset.tog : b.dataset.tog;
    OPEN.has(k) ? OPEN.delete(k) : OPEN.add(k);
    draw();
  });
  ROOT.querySelectorAll("[data-done]").forEach((cb) => cb.onchange = async () => {
    await save(+cb.dataset.done, { status: cb.checked ? "done" : "general" }); draw();
  });
  ROOT.querySelectorAll("[data-restore]").forEach((b) => b.onclick = async () => { await save(+b.dataset.restore, { trashed: false }); draw(); });
  ROOT.querySelectorAll("[data-purge]").forEach((b) => b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "click again to delete"; return; }
    await remove(+b.dataset.purge); draw();
  });
  ROOT.querySelectorAll("[data-body]").forEach((ta) => ta.onchange = () => save(+ta.dataset.body, { body: ta.value }));
  ROOT.querySelectorAll("[data-f]").forEach((el) => el.onchange = async () => {
    await save(+el.dataset.id, { [el.dataset.f]: el.value }); if (el.dataset.f === "status") draw();
  });

  // Notes under the list save themselves a moment after you stop typing.
  const notes = $("#td-notes", ROOT);
  const flush = async () => {
    clearTimeout(notesTimer); notesTimer = null;
    if (notes.value === NOTES.body) return;
    NOTES = await B.api("/todo_notes", "PUT", { body: notes.value });
    const s = $("#td-notes-saved", ROOT);
    if (s) s.textContent = `Saved ${when(NOTES.updated_at)}`;
  };
  notes.oninput = () => { clearTimeout(notesTimer); notesTimer = setTimeout(flush, 1200); };
  notes.onblur = flush;

  // Drag a card within or across columns; it lands before the card it is dropped on.
  let dragId = null;
  ROOT.querySelectorAll(".td-card").forEach((c) => {
    c.ondragstart = (e) => { dragId = +c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragId)); };
    c.ondragend = () => { c.classList.remove("dragging"); ROOT.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); };
  });
  ROOT.querySelectorAll(".td-col").forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); };
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = dragId || +e.dataTransfer.getData("text/plain");
      if (!id) return;
      const st = col.dataset.col;
      const target = e.target.closest(".td-card");
      const list = inCol(st).filter((t) => t.id !== id);
      let position;
      if (target && +target.dataset.id !== id) {
        const i = list.findIndex((t) => t.id === +target.dataset.id);
        const before = list[i - 1];
        position = before ? (before.position + list[i].position) / 2 : list[i].position - 1;
      } else position = (list.length ? list[list.length - 1].position : 0) + 1;
      await save(id, { status: st, position });
      draw();
    };
  });
}
