const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ul = (items, cls) =>
  `<ul class="ev ${cls}">${(items || []).map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;

let PROJECT = null, EXP = null, CTX = [], TAB = "plain";
let GLOSS = [], MATCHES = [], CONNS = [], TSTATUS = { ready: false, missing: [] };

async function api(path, method = "GET", body) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

async function boot() {
  let projects = await api("/projects");
  if (!projects.length) {
    projects = [await api("/projects", "POST", { name: "Untitled project", description: "" })];
  }
  PROJECT = projects[0];
  $("#projname").textContent = PROJECT.name;
  TSTATUS = await api("/transcription/status");
  await refreshList();
}

async function refreshList(selectId) {
  const exps = await api(`/projects/${PROJECT.id}/experiments`);
  $("#srclist").innerHTML = exps.length
    ? exps.map(e => `
      <div class="src ${EXP && e.id === EXP.id ? "on" : ""}" data-id="${e.id}">
        <div class="t">${esc(e.title)}</div>
        <div class="m">${e.commitment_count ? `${e.commitment_count} commitment${e.commitment_count > 1 ? "s" : ""}` : "no commitment yet"}${e.recording_count ? ` · ${e.recording_count} voice` : ""}</div>
      </div>`).join("")
    : `<div class="small muted">Nothing yet.</div>`;
  $("#srclist").querySelectorAll(".src").forEach(el =>
    el.onclick = () => openExperiment(+el.dataset.id));

  const target = selectId || (EXP && EXP.id) || (exps[0] && exps[0].id);
  if (target) await openExperiment(target);
  else { renderNewExperiment(); renderRail(); }
}

async function openExperiment(id) {
  EXP = await api(`/experiments/${id}`);
  document.querySelectorAll(".src").forEach(el =>
    el.classList.toggle("on", +el.dataset.id === id));
  render();
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

function render() {
  const c = EXP.commitments[EXP.commitments.length - 1] || null;
  const ch = c && c.challenges[c.challenges.length - 1] || null;
  const resp = ch && ch.responses[ch.responses.length - 1] || null;
  const step = (l, s) => `<div class="step ${s}">${l}</div>`;
  const ctx = Object.entries(EXP.context || {});

  $("#main").innerHTML = `
    <div class="steps">
      ${step("1 · Record", "done")}
      ${step("2 · Commit your view", c ? "done" : "now")}
      ${step("3 · Meet the argument", ch ? "done" : c ? "now" : "")}
      ${step("4 · Decide", resp ? "done" : ch ? "now" : "")}
    </div>
    <div class="card">
      <h2>${esc(EXP.title)}</h2>
      <div class="muted small">${esc(EXP.question) || "<em>no question recorded</em>"}</div>
      ${ctx.length ? `<div class="chips">${ctx.map(([k, v]) =>
        `<span class="chip">${esc(k)}: <strong>${esc(v)}</strong></span>`).join("")}</div>` : ""}
      <h3 style="margin-top:18px">Bench notes</h3>
      ${EXP.notes.length
        ? EXP.notes.map(n => `<div class="small" style="margin-bottom:5px">
            ${esc(n.body)}
            <span class="muted tiny">${n.source === "voice" ? "dictated · " : ""}${n.created_at.slice(0, 10)}</span>
          </div>`).join("")
        : `<div class="small muted">The things that decide whether it worked and never reach
           the spreadsheet. Consistency of a gel, a line that looked unhappy, beads sitting low.</div>`}
      <div class="row" style="margin-top:9px">
        <input id="note" placeholder="Add an observation…">
        <button class="ghost sm" id="btn-note">Add</button>
      </div>
    </div>
    ${renderConnectorOutput()}
    ${c ? renderCommitment(c) : renderCommitForm()}
    ${c ? (ch ? renderChallenge(ch, c, resp) : renderChallengeGate(c)) : ""}
  `;
  wire(c, ch);
}

function renderConnectorOutput() {
  if (!EXP.connector_calls || !EXP.connector_calls.length) return "";
  return EXP.connector_calls.filter(cc => cc.ok).map(cc => `
    <div class="third-block">
      <div class="who">${esc(cc.connector_name)}: your tool, not Benchcraft's</div>
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

function renderCommitment(c) {
  return `<div class="locked">
    <div class="stamp">Locked ${c.locked_at.replace("T", " ").slice(0, 16)}, your words, unedited</div>
    <dl style="margin:0">
      <dt>Expected</dt><dd>${esc(c.expected)}</dd>
      <dt>Observed</dt><dd>${esc(c.observed)}</dd>
      <dt>Your interpretation</dt><dd>${esc(c.interpretation)}</dd>
      <dt>Confidence</dt><dd class="conf">${c.confidence}/100</dd>
      <dt>Would change your mind</dt><dd>${esc(c.disconfirming)}</dd>
      ${c.proposed_next ? `<dt>Next experiment you proposed</dt><dd>${esc(c.proposed_next)}</dd>` : ""}
    </dl>
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
  <div class="ai-block">
    <div class="who">Generated blind: the model had not seen your interpretation</div>
    ${b.explanations.map(e => `
      <div class="hyp">
        <div><span class="lab">${esc(e.label)}</span><span class="kind">${esc(e.kind)}</span></div>
        <div class="small" style="margin-top:3px">${esc(e.statement)}</div>
        ${ul(e.supports, "pro")}${ul(e.contradicts, "con")}
        <div class="kill">Ruled out by: ${esc(e.would_rule_out)}</div>
      </div>`).join("")}
    <h3 style="margin-top:18px">Confounders this design allows</h3>
    ${(b.confounders || []).map(x =>
      `<div class="small" style="margin-bottom:5px"><strong>${esc(x.name)}</strong>: ${esc(x.why)}</div>`).join("")}
    <h3 style="margin-top:16px">Controls missing from the record</h3>
    ${ul(b.missing_controls, "con")}
    <h3 style="margin-top:16px">Cheapest way to tell them apart</h3>
    <div class="small">${esc(b.discriminating_experiment.description)}
      <span class="chip" style="margin-left:5px">${esc(b.discriminating_experiment.cost)}</span></div>
    <div class="small muted" style="margin-top:5px">${esc(b.discriminating_experiment.reads_out)}</div>
    ${(b.record_is_silent_on || []).length ? `
      <h3 style="margin-top:16px">Your record didn't say</h3>${ul(b.record_is_silent_on, "con")}` : ""}
  </div>

  ${d ? `<div class="ai-block" style="border-left-color:var(--mine);background:#eef1f7">
    <div class="who" style="color:var(--mine)">Where you and it diverge</div>
    <div class="small"><strong>Your reading maps to:</strong> ${esc(d.matches)}</div>
    ${(d.they_saw_that_you_missed || []).length ? `
      <h3 style="margin-top:15px">You saw what it did not</h3>${ul(d.they_saw_that_you_missed, "pro")}` : ""}
    ${(d.you_raised_that_they_did_not_address || []).length ? `
      <h3 style="margin-top:15px">It raised what you did not address</h3>
      ${ul(d.you_raised_that_they_did_not_address, "con")}` : ""}
    <h3 style="margin-top:15px">Strongest alternative you left unexamined</h3>
    <div class="small">${esc(d.strongest_unexamined_alternative)}</div>
    <div class="small muted" style="margin-top:4px"><em>To put it down:</em> ${esc(d.how_to_dismiss_it)}</div>
    <h3 style="margin-top:15px">On your stated confidence of ${c.confidence}</h3>
    <div class="small">${esc(d.confidence_note)}</div>
  </div>` : ""}

  ${resp ? `<div class="locked">
      <div class="stamp">You ${esc(resp.stance)} your position, confidence ${c.confidence} → ${resp.confidence_after}</div>
      <div>${esc(resp.reasoning)}</div>
      ${resp.chosen_next ? `<dt style="font-weight:600;font-size:12.5px;margin-top:9px">Next</dt>
        <dd style="margin:2px 0 0">${esc(resp.chosen_next)}</dd>` : ""}
    </div>
    <div class="card"><button class="ghost sm" id="btn-branch">Create the next experiment from this decision →</button></div>`
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
  if (TAB === "plain") return renderPlainRail();
  if (TAB === "voice") return renderVoiceRail();
  return renderConnRail();
}

function renderPlainRail() {
  const shown = MATCHES.length ? MATCHES : [];
  $("#rail").innerHTML = `
    <h3>In this experiment</h3>
    <p class="tiny muted" style="margin-top:-5px">Definitions only. What a term denotes, never what
    your result means. That part stays yours.</p>
    ${shown.length
      ? shown.map(g => `<div class="term">
          <div class="w">${esc(g.term)}<span class="src-tag">${g.source}</span></div>
          <div class="d">${esc(g.plain)}</div>
          <button class="link" data-del="${g.id}">remove</button>
        </div>`).join("")
      : `<div class="small muted">No terms matched yet.</div>`}
    <div style="margin-top:14px">
      <button class="ghost sm" id="g-detect" style="width:100%">Find terms in this record</button>
      <div class="tiny muted" style="margin-top:6px">Adds plain definitions for jargon it finds.
      Every one is editable and deletable.</div>
      <div class="err tiny" id="g-err"></div>
    </div>
    <div style="margin-top:14px">
      <h3>Add your own</h3>
      <input id="g-term" placeholder="term" style="margin-bottom:5px">
      <textarea id="g-plain" rows="2" placeholder="plain-language definition"></textarea>
      <button class="ghost sm" id="g-add" style="margin-top:6px;width:100%">Add</button>
    </div>
    ${GLOSS.length > shown.length ? `<div class="tiny muted" style="margin-top:14px">
      ${GLOSS.length - shown.length} more term${GLOSS.length - shown.length > 1 ? "s" : ""}
      in the project glossary, not mentioned here.</div>` : ""}`;

  $("#rail").querySelectorAll("[data-del]").forEach(el => el.onclick = async () => {
    GLOSS = await api(`/glossary/${el.dataset.del}`, "DELETE");
    MATCHES = MATCHES.filter(m => m.id !== +el.dataset.del);
    renderRail();
  });
  $("#g-detect").onclick = async (e) => {
    const b = e.target;
    b.disabled = true; b.innerHTML = `<span class="spin">◐</span> reading…`;
    try {
      GLOSS = await api(`/projects/${PROJECT.id}/glossary/detect`, "POST");
      MATCHES = await api(`/projects/${PROJECT.id}/glossary/matches/${EXP.id}`);
      renderRail();
    } catch (err) {
      b.disabled = false; b.textContent = "Find terms in this record";
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

function renderVoiceRail() {
  const recs = (EXP && EXP.recordings) || [];
  $("#rail").innerHTML = `
    <h3>Voice memos</h3>
    <p class="tiny muted" style="margin-top:-5px">
      Transcribed <strong>verbatim</strong> and stored as your words. Benchcraft does not
      summarise a voice note, ever. A summary of a hunch is someone else's hunch.</p>
    ${TSTATUS.ready
      ? `<div class="tiny muted">Runs locally on this Mac: ${esc(TSTATUS.engine)}. Audio never leaves the machine.</div>`
      : `<div class="tiny" style="color:#8d3b32">Local transcription not set up:<br>${
          TSTATUS.missing.map(m => `· ${esc(m)}`).join("<br>")}<br>
          You can still upload and type the transcript yourself.</div>`}
    <div class="drop" id="drop" style="margin-top:11px">
      Drop an MP3 here, or click to choose<br>
      <span class="tiny">mp3 · m4a · wav · aac · ogg · flac</span>
    </div>
    <input type="file" id="file" accept="audio/*,video/mp4,video/quicktime" style="display:none">
    <div class="err tiny" id="v-err"></div>
    <div style="margin-top:13px">
      ${recs.length ? recs.map(r => `
        <div class="rec">
          <div class="small" style="font-weight:500">${esc(r.filename)}</div>
          <div class="tiny muted">${r.duration_s ? `${r.duration_s}s · ` : ""}${r.created_at.slice(0, 10)}</div>
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
    </div>`;

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
    } catch (err) { $("#v-err").textContent = err.message; el.disabled = false; el.textContent = "Transcribe"; }
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
  render(); renderRail();
}

function renderConnRail() {
  $("#rail").innerHTML = `
    <h3>Your tools</h3>
    <p class="tiny muted" style="margin-top:-5px">Accounts and agents you bring. Their output is
    shown as a third voice, attributed and separate, never merged into your commitment, never
    fed to the challenger.</p>
    ${CONNS.length ? CONNS.map(c => `
      <div class="conn">
        <div class="small" style="font-weight:600">${esc(c.name)}</div>
        <div class="tiny muted">${esc(c.endpoint || "no endpoint set")}${c.key_env ? ` · ${esc(c.key_env)}` : ""}</div>
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
      <div class="tiny muted" style="margin-top:7px">Benchcraft POSTs
        <code>{question, experiment}</code> as JSON and shows whatever text comes back.</div>
    </div>
    <div style="margin-top:14px">
      <h3>Suggested</h3>
      <div id="c-sugg" class="tiny muted">…</div>
    </div>`;

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
  const conf = $("#f-confidence");
  if (conf) conf.oninput = () => $("#conflabel").textContent = conf.value;
  const rconf = $("#r-confidence");
  if (rconf) rconf.oninput = () => $("#r-conflabel").textContent = rconf.value;

  const note = $("#btn-note");
  if (note) note.onclick = async () => {
    const body = $("#note").value.trim();
    if (!body) return;
    EXP = await api(`/experiments/${EXP.id}/notes`, "POST", { body });
    render();
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
      render();
    } catch (e) { lock.disabled = false; $("#lock-err").textContent = e.message; }
  };

  const btnCh = $("#btn-challenge");
  if (btnCh) btnCh.onclick = async () => {
    btnCh.disabled = true;
    btnCh.innerHTML = `<span class="spin">◐</span> thinking against you…`;
    try { EXP = await api(`/commitments/${c.id}/challenge`, "POST"); render(); }
    catch (e) {
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
      render();
    } catch (e) { btnR.disabled = false; $("#r-err").textContent = e.message; }
  };

  const branch = $("#btn-branch");
  if (branch) branch.onclick = () => renderNewExperiment(EXP.id);
}

function renderNewExperiment(parentId) {
  CTX = [["cell line", ""], ["passage", ""], ["differentiation day", ""]];
  const rows = () => CTX.map((_, i) => `
    <div class="ctx-row">
      <input placeholder="variable" value="${esc(CTX[i][0])}" data-k="${i}">
      <input placeholder="value" value="${esc(CTX[i][1])}" data-v="${i}">
      <button class="ghost sm" data-x="${i}">×</button>
    </div>`).join("");

  $("#main").innerHTML = `<div class="card">
    <h2>${parentId ? "Next experiment" : "New experiment"}</h2>
    ${parentId ? `<div class="small muted">Linked in the decision graph as the step you chose
      after the previous one.</div>` : ""}
    <label>Title</label><input id="n-title">
    <label>What question is this asking?
      <span class="hint">The question, not the technique.</span></label>
    <textarea id="n-question" rows="2"></textarea>
    <label>Experimental context
      <span class="hint">Every variable here is one the challenge can reason about as a
      confounder, so record the boring ones: batch, lot, passage.</span></label>
    <div id="ctx">${rows()}</div>
    <button class="ghost sm" id="ctx-add">+ variable</button>
    <div style="margin-top:16px"><button id="n-save">Create</button></div>
    <div class="err" id="n-err"></div>
  </div>`;

  const bind = () => {
    $("#ctx").querySelectorAll("[data-k]").forEach(el =>
      el.oninput = () => CTX[+el.dataset.k][0] = el.value);
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
    const created = await api(`/projects/${PROJECT.id}/experiments`, "POST", {
      title, question: $("#n-question").value.trim(),
      context: Object.fromEntries(CTX.filter(([k, v]) => k.trim() && v.trim())),
      parent_experiment_id: parentId || null,
    });
    EXP = created;
    await refreshList(created.id);
  };
}

document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  TAB = t.dataset.tab;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === t));
  renderRail();
});

$("#btn-new").onclick = () => renderNewExperiment();

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
      ? ` <span class="chip">${n.confidence} → ${n.confidence_after}</span>` : "";
    return `<div style="margin-left:${depth * 20}px;padding:7px 0;${depth ? "border-left:1px solid var(--rule);padding-left:13px" : ""}">
      <strong>${esc(n.title)}</strong>${n.confidence != null
        ? ` <span class="conf muted small">confidence ${n.confidence}</span>` : ""}${move}
      ${n.stance ? ` <span class="chip">${esc(n.stance)}</span>` : ""}
      ${!n.challenged ? ` <span class="chip">unchallenged</span>` : ""}
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
      <div class="small">${stances.map(([s, n]) => `${s}: ${n}`).join(" · ")}.
      <span class="muted">Never moving is stubbornness; always moving is deference.</span></div>` : ""}`;
  modal.showModal();
};

boot();
