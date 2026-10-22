import { $, $$, esc, toast, openModal, downloadText, csvCell } from "./util.js";

/* ===================== Entrenamientos y asistencia ===================== */

const OBJ = { tactico: "Táctico", tecnico: "Técnico", fisico: "Físico", recuperacion: "Recuperación", balon_parado: "Balón parado", partido: "Preparación de partido", otro: "Otro" };
const OBJ_COL = { tactico: "#19c3c3", tecnico: "#7fb3ff", fisico: "#ec7063", recuperacion: "#2ecc71", balon_parado: "#f5b041", partido: "#c39bd3", otro: "#9db3d1" };
const EX_CAT = ["Calentamiento", "Técnica", "Posesión", "Táctica", "Finalización", "Físico", "Balón parado", "Porteros", "Recuperación", "Otro"];
const ST = { pendiente: "Pendiente", presente: "Presente", ausente: "Ausente", justificada: "Ausencia justificada", lesionado: "Lesionado", limitada: "Participación limitada" };
const ST_COL = { pendiente: "#9db3d1", presente: "#2ecc71", ausente: "#ec7063", justificada: "#f5b041", lesionado: "#c0392b", limitada: "#7fb3ff" };
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const T = {
  sb: null, user: null, el: null, tab: "calendario", view: "week", cursor: new Date(), noSql: false, chart: null,
  players: [], sessions: [], exercises: [], sx: [], att: [], range: "90", exQ: "", exCat: "",
};

/* ---------- fechas ---------- */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const today = () => ymd(new Date());
const fail = (error) => { if (error) { toast(error.message, "err"); return true; } return false; };

/* ---------- carga ---------- */
async function load() {
  const t = (n) => T.sb.from(n).select("*");
  const [p, s, e, x, a] = await Promise.all([t("gm_players"), t("gm_training_sessions"), t("gm_exercises"), t("gm_session_exercises"), t("gm_attendance")]);
  T.noSql = !!(s.error || e.error || x.error || a.error);
  T.players = (p.data || []).sort((u, v) => u.name.localeCompare(v.name));
  T.sessions = s.data || [];
  T.exercises = (e.data || []).sort((u, v) => u.name.localeCompare(v.name));
  T.sx = (x.data || []).sort((u, v) => u.sort - v.sort);
  T.att = a.data || [];
}
async function reload() { await load(); render(); }

export async function mountTraining(el, { sb, user }) {
  T.sb = sb; T.user = user; T.el = el;
  el.innerHTML = `<p class="muted">Cargando entrenamientos…</p>`;
  await load();
  render();
}

function render() {
  if (T.chart) { T.chart.destroy(); T.chart = null; }
  if (T.noSql) { T.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_entrenamientos.sql</code> en el SQL Editor y recarga la página.</div>`; return; }
  const tabs = [["calendario", "Calendario"], ["ejercicios", "Biblioteca de ejercicios"], ["asistencia", "Asistencia"], ["informes", "Informes"]];
  T.el.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${T.tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div id="pane"></div>`;
  $$("[data-t]", T.el).forEach((b) => b.addEventListener("click", () => { T.tab = b.dataset.t; render(); }));
  ({ calendario: renderCalendar, ejercicios: renderExercises, asistencia: renderAttendance, informes: renderReports })[T.tab]($("#pane", T.el));
}

const real = () => T.sessions.filter((s) => !s.is_template);
const templates = () => T.sessions.filter((s) => s.is_template);

/* ======================= Calendario ======================= */
function renderCalendar(pane) {
  const w = T.view === "week";
  const start = w ? monday(T.cursor) : monday(new Date(T.cursor.getFullYear(), T.cursor.getMonth(), 1));
  const nDays = w ? 7 : 42;
  const days = Array.from({ length: nDays }, (_, i) => addDays(start, i));
  const title = w ? `${start.getDate()} ${MONTHS[start.getMonth()]} – ${addDays(start, 6).getDate()} ${MONTHS[addDays(start, 6).getMonth()]} ${addDays(start, 6).getFullYear()}`
    : `${MONTHS[T.cursor.getMonth()]} ${T.cursor.getFullYear()}`;
  const tpl = templates();
  pane.innerHTML = `
    <div class="toolbar">
      <button class="btn ghost sm" id="prev">◀</button><button class="btn ghost sm" id="tod">Hoy</button><button class="btn ghost sm" id="next">▶</button>
      <b style="min-width:200px;text-transform:capitalize">${title}</b>
      <button class="btn ${w ? "" : "ghost"} sm" data-v="week">Semana</button><button class="btn ${w ? "ghost" : ""} sm" data-v="month">Mes</button>
      <span style="flex:1"></span>
      <button class="btn" id="ns">+ Nueva sesión</button>
      ${tpl.length ? `<select id="tp" style="max-width:200px"><option value="">Desde plantilla…</option>${tpl.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join("")}</select>` : ""}
    </div>
    <div class="cal ${w ? "week" : "month"}">
      ${DAYS.map((d) => `<div class="cal-h">${d}</div>`).join("")}
      ${days.map((d) => {
        const k = ymd(d), list = real().filter((s) => s.session_date === k).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
        const other = !w && d.getMonth() !== T.cursor.getMonth();
        return `<div class="cal-d ${k === today() ? "today" : ""} ${other ? "other" : ""}" data-day="${k}">
          <div class="cal-n">${d.getDate()}</div>
          ${list.map((s) => `<div class="cal-s" data-s="${s.id}" style="border-left:4px solid ${OBJ_COL[s.objective]}" title="${esc(s.title)}">
            <b>${(s.start_time || "").slice(0, 5)}</b> ${esc(s.title)}${w ? `<div class="muted">${OBJ[s.objective]} · ${s.duration_min}'${s.location ? " · " + esc(s.location) : ""}</div>` : ""}</div>`).join("")}
        </div>`;
      }).join("")}
    </div>
    <p class="muted">Clic en un día para crear una sesión; clic en una sesión para editarla y pasar lista.</p>`;
  const step = (n) => { T.cursor = w ? addDays(T.cursor, 7 * n) : new Date(T.cursor.getFullYear(), T.cursor.getMonth() + n, 1); renderCalendar(pane); };
  $("#prev", pane).addEventListener("click", () => step(-1));
  $("#next", pane).addEventListener("click", () => step(1));
  $("#tod", pane).addEventListener("click", () => { T.cursor = new Date(); renderCalendar(pane); });
  $$("[data-v]", pane).forEach((b) => b.addEventListener("click", () => { T.view = b.dataset.v; renderCalendar(pane); }));
  $("#ns", pane).addEventListener("click", () => sessionForm(null, { date: today() }));
  $("#tp", pane)?.addEventListener("change", (e) => { if (e.target.value) sessionForm(null, { fromTemplate: e.target.value, date: today() }); });
  $$("[data-day]", pane).forEach((c) => c.addEventListener("click", (e) => {
    const s = e.target.closest("[data-s]");
    if (s) sessionForm(T.sessions.find((x) => x.id === s.dataset.s));
    else sessionForm(null, { date: c.dataset.day });
  }));
}

/* ---------- Formulario de sesión ---------- */
function sessionForm(session, opts = {}) {
  const src = session || (opts.fromTemplate ? T.sessions.find((x) => x.id === opts.fromTemplate) : null);
  const isEdit = !!session && !session.is_template;
  const srcEx = src ? T.sx.filter((x) => x.session_id === src.id).map((x) => ({ exercise_id: x.exercise_id, minutes: x.minutes, notes: x.notes || "" })) : [];
  const srcAtt = src ? T.att.filter((a) => a.session_id === src.id) : [];
  const convoc = new Map(srcAtt.map((a) => [a.player_id, { status: opts.fromTemplate || session?.is_template ? "pendiente" : a.status, note: opts.fromTemplate ? "" : a.note || "" }]));
  const v = (k, d = "") => esc(src?.[k] ?? d);
  const ex = [...srcEx];

  const m = openModal(`
    <h2>${isEdit ? "Sesión de entrenamiento" : session?.is_template ? "Plantilla: " + esc(session.title) : "Nueva sesión"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f">
      <div class="row">
        <div style="flex:2"><label>Título *</label><input name="title" required value="${v("title", opts.fromTemplate ? "" : "Entrenamiento")}"></div>
        <div><label>Fecha *</label><input type="date" name="date" required value="${isEdit ? v("session_date") : opts.date || today()}"></div>
        <div><label>Hora</label><input type="time" name="time" value="${(src?.start_time || "10:00").slice(0, 5)}"></div>
        <div><label>Duración (min)</label><input type="number" name="dur" min="1" max="300" required value="${src?.duration_min ?? 90}"></div>
      </div>
      <div class="row">
        <div><label>Lugar</label><input name="loc" value="${v("location")}" placeholder="Campo de entrenamiento"></div>
        <div><label>Entrenador responsable</label><input name="coach" value="${v("coach")}"></div>
        <div><label>Objetivo</label><select name="obj">${Object.entries(OBJ).map(([k, l]) => `<option value="${k}" ${(src?.objective || "tactico") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>Intensidad (1-10)</label><input type="number" name="int" min="1" max="10" value="${src?.intensity ?? 5}"></div>
      </div>
      <label>Observaciones del entrenador</label><textarea name="notes" rows="2">${v("notes")}</textarea>

      <h3 style="margin-top:1rem">Ejercicios <span class="muted" id="exsum"></span></h3>
      <div id="exs"></div>
      <div class="toolbar"><select id="exadd"><option value="">+ Añadir ejercicio de la biblioteca…</option>${T.exercises.map((e) => `<option value="${e.id}">${esc(e.name)} (${e.duration_min}')</option>`).join("")}</select></div>
      ${T.exercises.length ? "" : `<p class="muted">Aún no hay ejercicios: créalos en la pestaña Biblioteca de ejercicios.</p>`}

      <h3 style="margin-top:1rem">Convocatoria y asistencia</h3>
      <div class="toolbar"><button type="button" class="btn ghost sm" id="all">Convocar a todos</button><button type="button" class="btn ghost sm" id="allp">Marcar convocados como presentes</button><button type="button" class="btn ghost sm" id="none">Quitar a todos</button></div>
      <div class="tw" style="max-height:320px"><table><thead><tr><th>Conv.</th><th>Jugador</th><th>Pos</th><th>Estado</th><th>Nota</th></tr></thead>
      <tbody>${T.players.map((p) => { const c = convoc.get(p.id); return `<tr data-p="${p.id}"><td><input type="checkbox" class="cv" ${c ? "checked" : ""}></td>
        <td><b>${esc(p.name)}</b></td><td><span class="pos">${esc(p.position || "–")}</span></td>
        <td><select class="stt" ${c ? "" : "disabled"}>${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${(c?.status || "pendiente") === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        <td><input class="nt" value="${esc(c?.note || "")}" ${c ? "" : "disabled"}></td></tr>`; }).join("")}</tbody></table></div>
      ${T.players.length ? "" : `<p class="muted">No hay jugadores en la plantilla.</p>`}

      <div class="actions">
        ${isEdit ? `<button type="button" class="btn danger" id="del">Eliminar</button><button type="button" class="btn ghost" id="dup">Duplicar</button>` : ""}
        ${session?.is_template ? `<button type="button" class="btn danger" id="del">Eliminar plantilla</button>` : ""}
        ${!session?.is_template ? `<button type="button" class="btn ghost" id="tpl">Guardar como plantilla</button>` : ""}
        <button class="btn">Guardar</button>
      </div>
    </form>`, { wide: true });
  const f = $("#f", m.el);

  const drawEx = () => {
    $("#exs", m.el).innerHTML = ex.length ? `<table style="min-width:0"><tbody>${ex.map((e, i) => `<tr><td>${i + 1}.</td>
      <td><b>${esc(T.exercises.find((x) => x.id === e.exercise_id)?.name || "?")}</b></td>
      <td><input type="number" min="1" data-min="${i}" value="${e.minutes}" style="width:70px"> min</td>
      <td><input data-note="${i}" value="${esc(e.notes)}" placeholder="Notas"></td>
      <td><button type="button" class="btn ghost sm" data-up="${i}">↑</button><button type="button" class="btn ghost sm" data-rm="${i}">✕</button></td></tr>`).join("")}</tbody></table>` : `<p class="muted">Sin ejercicios.</p>`;
    const tot = ex.reduce((s, e) => s + (Number(e.minutes) || 0), 0), dur = Number(f.dur.value) || 0;
    $("#exsum", m.el).textContent = ex.length ? `— ${tot} min de ${dur} min${tot > dur ? " ⚠ supera la duración" : ""}` : "";
    $$("[data-min]", m.el).forEach((i) => i.addEventListener("input", () => { ex[i.dataset.min].minutes = Number(i.value) || 1; const t2 = ex.reduce((s, e) => s + e.minutes, 0); $("#exsum", m.el).textContent = `— ${t2} min de ${Number(f.dur.value) || 0} min${t2 > (Number(f.dur.value) || 0) ? " ⚠ supera la duración" : ""}`; }));
    $$("[data-note]", m.el).forEach((i) => i.addEventListener("input", () => { ex[i.dataset.note].notes = i.value; }));
    $$("[data-rm]", m.el).forEach((b) => b.addEventListener("click", () => { ex.splice(Number(b.dataset.rm), 1); drawEx(); }));
    $$("[data-up]", m.el).forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.up); if (i > 0) { [ex[i - 1], ex[i]] = [ex[i], ex[i - 1]]; drawEx(); } }));
  };
  drawEx();
  $("#exadd", m.el).addEventListener("change", (e) => {
    const x = T.exercises.find((y) => y.id === e.target.value); if (!x) return;
    ex.push({ exercise_id: x.id, minutes: x.duration_min, notes: "" }); e.target.value = ""; drawEx();
  });
  f.dur.addEventListener("input", drawEx);

  const rows = () => $$("tbody tr[data-p]", m.el);
  rows().forEach((tr) => $(".cv", tr).addEventListener("change", () => {
    const on = $(".cv", tr).checked; $(".stt", tr).disabled = !on; $(".nt", tr).disabled = !on;
  }));
  const setAll = (on, status) => rows().forEach((tr) => {
    $(".cv", tr).checked = on; $(".stt", tr).disabled = !on; $(".nt", tr).disabled = !on;
    if (on && status && $(".cv", tr).checked) $(".stt", tr).value = status;
  });
  $("#all", m.el).addEventListener("click", () => setAll(true));
  $("#none", m.el).addEventListener("click", () => setAll(false));
  $("#allp", m.el).addEventListener("click", () => rows().forEach((tr) => { if ($(".cv", tr).checked) $(".stt", tr).value = "presente"; }));

  async function persist({ asTemplate = false, existingId = null }) {
    const fd = new FormData(f);
    const title = String(fd.get("title")).trim();
    if (!title) return toast("Falta el título.", "err");
    if (ex.some((e) => !T.exercises.find((x) => x.id === e.exercise_id))) return toast("Hay un ejercicio que ya no existe.", "err");
    const row = {
      title, session_date: asTemplate ? null : fd.get("date"), start_time: fd.get("time") || null, duration_min: Number(fd.get("dur")) || 90,
      location: String(fd.get("loc")).trim() || null, coach: String(fd.get("coach")).trim() || null, objective: fd.get("obj"),
      intensity: Math.min(10, Math.max(1, Number(fd.get("int")) || 5)), notes: String(fd.get("notes")).trim() || null, is_template: asTemplate,
    };
    if (!asTemplate && !row.session_date) return toast("Falta la fecha.", "err");
    let id = existingId;
    if (id) { if (fail((await T.sb.from("gm_training_sessions").update(row).eq("id", id)).error)) return false; }
    else {
      const { data, error } = await T.sb.from("gm_training_sessions").insert(row).select().single();
      if (fail(error)) return false;
      id = data.id;
    }
    if (fail((await T.sb.from("gm_session_exercises").delete().eq("session_id", id)).error)) return false;
    if (ex.length && fail((await T.sb.from("gm_session_exercises").insert(ex.map((e, i) => ({ session_id: id, exercise_id: e.exercise_id, minutes: e.minutes, notes: e.notes || null, sort: i })))).error)) return false;
    const keep = rows().filter((tr) => $(".cv", tr).checked);
    const keepIds = keep.map((tr) => tr.dataset.p);
    const gone = T.att.filter((a) => a.session_id === id && !keepIds.includes(a.player_id)).map((a) => a.id);
    if (gone.length && fail((await T.sb.from("gm_attendance").delete().in("id", gone)).error)) return false;
    if (keep.length) {
      const up = keep.map((tr) => ({ user_id: T.user.id, session_id: id, player_id: tr.dataset.p, status: asTemplate ? "pendiente" : $(".stt", tr).value, note: $(".nt", tr).value.trim() || null }));
      if (fail((await T.sb.from("gm_attendance").upsert(up, { onConflict: "session_id,player_id" })).error)) return false;
    }
    return id;
  }

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = await persist({ asTemplate: !!session?.is_template, existingId: session?.id || null });
    if (id) { m.close(); toast("Sesión guardada"); reload(); }
  });
  $("#tpl", m.el)?.addEventListener("click", async () => {
    const n = (prompt("Nombre de la plantilla:", String(new FormData(f).get("title"))) || "").trim();
    if (!n) return;
    f.title.value = n;
    const id = await persist({ asTemplate: true });
    if (id) toast("Plantilla guardada");
    reload();
  });
  $("#dup", m.el)?.addEventListener("click", async () => {
    const d = prompt("Fecha de la copia (AAAA-MM-DD):", ymd(addDays(parse(session.session_date), 7)));
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    f.date.value = d;
    rows().forEach((tr) => { if ($(".cv", tr).checked) $(".stt", tr).value = "pendiente"; });
    const id = await persist({ asTemplate: false });
    if (id) { m.close(); toast("Sesión duplicada"); reload(); }
  });
  $("#del", m.el)?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar? También se borra su asistencia.")) return;
    if (fail((await T.sb.from("gm_training_sessions").delete().eq("id", session.id)).error)) return;
    m.close(); toast("Eliminada"); reload();
  });
}

/* ======================= Biblioteca de ejercicios ======================= */
function renderExercises(pane) {
  const q = T.exQ.toLowerCase();
  const list = T.exercises.filter((e) => (!T.exCat || e.category === T.exCat) && (!q || (e.name + " " + (e.description || "")).toLowerCase().includes(q)));
  pane.innerHTML = `<div class="toolbar"><input id="q" placeholder="Buscar ejercicio…" value="${esc(T.exQ)}">
    <select id="cat"><option value="">Todas las categorías</option>${EX_CAT.map((c) => `<option ${T.exCat === c ? "selected" : ""}>${c}</option>`).join("")}</select>
    <button class="btn" id="ne">+ Ejercicio</button><span class="muted">${list.length} de ${T.exercises.length}</span></div>
    ${T.exercises.length ? "" : `<div class="card muted">La biblioteca está vacía. Crea tus ejercicios (con descripción, instrucciones y diagrama) para usarlos en las sesiones.</div>`}
    <div class="grid g2">${list.map((e) => `<div class="card" data-e="${e.id}" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;gap:.5rem"><h3>${esc(e.name)}</h3><span class="badge">${esc(e.category)} · ${e.duration_min}'</span></div>
      ${e.diagram ? `<img src="${e.diagram}" alt="Diagrama" style="max-width:100%;max-height:150px;border-radius:8px;background:#fff1">` : ""}
      <p class="muted">${esc((e.description || "").slice(0, 160))}</p></div>`).join("")}</div>`;
  $("#q", pane).addEventListener("input", (e) => { T.exQ = e.target.value; renderExercises(pane); $("#q", pane).focus(); });
  $("#cat", pane).addEventListener("change", (e) => { T.exCat = e.target.value; renderExercises(pane); });
  $("#ne", pane).addEventListener("click", () => exerciseForm());
  $$("[data-e]", pane).forEach((c) => c.addEventListener("click", () => exerciseForm(T.exercises.find((x) => x.id === c.dataset.e))));
}

function resizeImage(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("No se pudo leer la imagen.")); };
    img.src = url;
  });
}

function exerciseForm(e = null) {
  let diagram = e?.diagram || null;
  const used = e ? T.sx.filter((x) => x.exercise_id === e.id).length : 0;
  const m = openModal(`<h2>${e ? "Editar ejercicio" : "Nuevo ejercicio"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <form id="f"><div class="row">
      <div style="flex:2"><label>Nombre *</label><input name="name" required value="${esc(e?.name || "")}"></div>
      <div><label>Categoría</label><select name="cat">${EX_CAT.map((c) => `<option ${(e?.category || "Otro") === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div><label>Duración (min)</label><input type="number" name="dur" min="1" required value="${e?.duration_min ?? 15}"></div>
    </div>
    <label>Descripción</label><textarea name="desc" rows="2">${esc(e?.description || "")}</textarea>
    <label>Instrucciones</label><textarea name="ins" rows="4" placeholder="Organización, reglas, variantes, puntos clave…">${esc(e?.instructions || "")}</textarea>
    <label>Diagrama (imagen, opcional — puedes subir una captura de la Pizarra)</label>
    <input type="file" id="img" accept="image/*"><div id="prev" style="margin-top:.4rem"></div>
    ${used ? `<p class="muted">Usado en ${used} sesión(es).</p>` : ""}
    <div class="actions">${e ? `<button type="button" class="btn danger" id="del">Eliminar</button>` : ""}<button class="btn">Guardar</button></div></form>`, { wide: true });
  const prev = () => { $("#prev", m.el).innerHTML = diagram ? `<img src="${diagram}" style="max-width:100%;max-height:220px;border-radius:8px"> <button type="button" class="btn ghost sm" id="rmimg">Quitar</button>` : ""; $("#rmimg", m.el)?.addEventListener("click", () => { diagram = null; prev(); }); };
  prev();
  $("#img", m.el).addEventListener("change", async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    try { diagram = await resizeImage(file); prev(); } catch (err) { toast(err.message, "err"); }
  });
  $("#f", m.el).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const row = { name: String(fd.get("name")).trim(), category: fd.get("cat"), duration_min: Number(fd.get("dur")) || 15,
      description: String(fd.get("desc")).trim() || null, instructions: String(fd.get("ins")).trim() || null, diagram };
    const { error } = e ? await T.sb.from("gm_exercises").update(row).eq("id", e.id) : await T.sb.from("gm_exercises").insert(row);
    if (error) return toast(error.code === "23505" ? "Ya existe un ejercicio con ese nombre." : error.message, "err");
    m.close(); toast("Ejercicio guardado"); reload();
  });
  $("#del", m.el)?.addEventListener("click", async () => {
    if (!confirm("¿Eliminar este ejercicio?")) return;
    const { error } = await T.sb.from("gm_exercises").delete().eq("id", e.id);
    if (error) return toast(error.code === "23503" ? "Está en sesiones; quítalo de ellas primero." : error.message, "err");
    m.close(); reload();
  });
}

/* ======================= Asistencia ======================= */
function rangeBounds() {
  const to = today();
  if (T.range === "all") return ["0000-00-00", to];
  if (T.range.includes("..")) { const [a, b] = T.range.split(".."); return [a || "0000-00-00", b || to]; }
  return [ymd(addDays(new Date(), -Number(T.range))), to];
}

// Estadísticas de asistencia por jugador dentro del rango (solo sesiones ya pasadas y con estado registrado)
export function attendanceStats(from, to) {
  const sess = new Map(real().filter((s) => s.session_date >= from && s.session_date <= to).map((s) => [s.id, s]));
  return T.players.map((p) => {
    const recs = T.att.filter((a) => a.player_id === p.id && sess.has(a.session_id) && a.status !== "pendiente")
      .map((a) => ({ ...a, s: sess.get(a.session_id) })).sort((a, b) => b.s.session_date.localeCompare(a.s.session_date) || (b.s.start_time || "").localeCompare(a.s.start_time || ""));
    const c = { presente: 0, ausente: 0, justificada: 0, lesionado: 0, limitada: 0 };
    recs.forEach((r) => { c[r.status]++; });
    let streak = 0;
    for (const r of recs) { if (r.status === "ausente" || r.status === "justificada") streak++; else break; }
    const pct = recs.length ? ((c.presente + c.limitada) / recs.length) * 100 : null;
    return { p, recs, c, total: recs.length, pct, streak };
  });
}

function renderAttendance(pane) {
  const [from, to] = rangeBounds();
  const stats = attendanceStats(from, to);
  const [cf, ct] = T.range.includes("..") ? T.range.split("..") : ["", ""];
  pane.innerHTML = `<div class="toolbar"><label style="margin:0">Período</label>
    <select id="rg">${[["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["365", "Último año"], ["all", "Todo"], ["custom", "Personalizado"]].map(([k, l]) => `<option value="${k}" ${(T.range.includes("..") ? "custom" : T.range) === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input type="date" id="rf" value="${cf}" style="max-width:150px"><input type="date" id="rt" value="${ct}" style="max-width:150px">
    <button class="btn ghost sm" id="csv">Exportar CSV</button></div>
    <p class="muted">Solo cuentan sesiones ya realizadas con estado registrado. % asistencia = (presente + participación limitada) / registros. Ausencias consecutivas = ausente o justificada seguidas, de más reciente a más antigua.</p>
    <div class="tw"><table><thead><tr><th>Jugador</th><th class="num">Sesiones</th><th class="num">Presente</th><th class="num">Limitada</th><th class="num">Justif.</th><th class="num">Ausente</th><th class="num">Lesionado</th><th>% asistencia</th><th class="num">Ausencias seguidas</th></tr></thead>
    <tbody>${stats.map((s) => `<tr class="click" data-p="${s.p.id}"><td><b>${esc(s.p.name)}</b></td><td class="num">${s.total}</td><td class="num">${s.c.presente}</td><td class="num">${s.c.limitada}</td>
      <td class="num">${s.c.justificada}</td><td class="num">${s.c.ausente}</td><td class="num">${s.c.lesionado}</td>
      <td>${s.pct == null ? `<span class="muted">sin datos</span>` : `<div class="bar"><i class="${s.pct < 60 ? "bad" : s.pct < 80 ? "warn" : ""}" style="width:${s.pct}%"></i></div> <span class="muted">${s.pct.toFixed(0)}%</span>`}</td>
      <td class="num ${s.streak >= 3 ? "flag-bad" : s.streak ? "flag-warn" : ""}">${s.streak}</td></tr>`).join("")}</tbody></table></div>
    ${T.players.length ? "" : `<div class="card muted">No hay jugadores.</div>`}`;
  const rg = $("#rg", pane), rf = $("#rf", pane), rt = $("#rt", pane);
  rf.hidden = rt.hidden = rg.value !== "custom";
  rg.addEventListener("change", () => { T.range = rg.value === "custom" ? ".." : rg.value; renderAttendance(pane); });
  [rf, rt].forEach((i) => i.addEventListener("change", () => { T.range = `${rf.value}..${rt.value}`; renderAttendance(pane); }));
  $("#csv", pane).addEventListener("click", () => {
    const head = ["Jugador", "Sesiones", "Presente", "Limitada", "Justificada", "Ausente", "Lesionado", "% asistencia", "Ausencias seguidas"];
    const lines = [head, ...stats.map((s) => [s.p.name, s.total, s.c.presente, s.c.limitada, s.c.justificada, s.c.ausente, s.c.lesionado, s.pct == null ? "" : s.pct.toFixed(1), s.streak])];
    downloadText(`asistencia_${today()}.csv`, lines.map((r) => r.map(csvCell).join(",")).join("\n"));
  });
  $$("tr.click", pane).forEach((tr) => tr.addEventListener("click", () => playerHistory(tr.dataset.p, from, to)));
}

function playerHistory(pid, from, to) {
  const s = attendanceStats(from, to).find((x) => x.p.id === pid);
  const m = openModal(`<h2>${esc(s.p.name)} — historial <button class="btn ghost sm" data-close>Cerrar</button></h2>
    <p>${s.total} sesiones · asistencia ${s.pct == null ? "–" : s.pct.toFixed(0) + "%"} · ausencias seguidas: ${s.streak}</p>
    <div class="tw" style="max-height:60vh"><table><thead><tr><th>Fecha</th><th>Sesión</th><th>Objetivo</th><th>Estado</th><th>Nota</th></tr></thead>
    <tbody>${s.recs.map((r) => `<tr><td>${r.s.session_date}</td><td>${esc(r.s.title)}</td><td>${OBJ[r.s.objective]}</td>
      <td><span style="color:${ST_COL[r.status]}">●</span> ${ST[r.status]}</td><td>${esc(r.note || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sin registros en el período.</td></tr>`}</tbody></table></div>`, { wide: true });
  return m;
}

/* ======================= Informes ======================= */
function renderReports(pane) {
  const [from, to] = rangeBounds();
  const past = real().filter((s) => s.session_date >= from && s.session_date <= to);
  const future = real().filter((s) => s.session_date > today());
  const stats = attendanceStats(from, to);
  const withData = stats.filter((s) => s.pct != null);
  const avg = withData.length ? withData.reduce((t, s) => t + s.pct, 0) / withData.length : null;
  const byObj = {};
  past.forEach((s) => { byObj[s.objective] = (byObj[s.objective] || 0) + 1; });
  const obs = past.filter((s) => s.notes).sort((a, b) => b.session_date.localeCompare(a.session_date)).slice(0, 12);
  const alerts = stats.filter((s) => s.streak >= 3 || (s.pct != null && s.pct < 70 && s.total >= 3));

  pane.innerHTML = `<div class="toolbar"><label style="margin:0">Período</label>
    <select id="rg">${[["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["365", "Último año"], ["all", "Todo"]].map(([k, l]) => `<option value="${k}" ${T.range === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="btn ghost sm" id="csvs">Exportar sesiones (CSV)</button><button class="btn ghost sm" id="csvm">Exportar matriz de asistencia (CSV)</button></div>
    <div class="g6">${[["Sesiones realizadas", past.length], ["Sesiones planificadas", future.length], ["Asistencia media", avg == null ? "–" : avg.toFixed(0) + "%"],
      ["Horas entrenadas", (past.reduce((t, s) => t + s.duration_min, 0) / 60).toFixed(1)], ["Alertas", alerts.length]]
      .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="grid g2" style="margin-top:1rem">
      <div class="card"><h3>Carga de entrenamiento planificada</h3><canvas id="ld" height="200"></canvas><p class="muted">Carga = duración × intensidad (1-10) de cada sesión, por semana. 8 semanas atrás y 4 por delante.</p></div>
      <div class="card"><h3>Sesiones por objetivo</h3>${Object.keys(byObj).length ? Object.entries(byObj).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div><span style="color:${OBJ_COL[k]}">●</span> ${OBJ[k]}: <b>${n}</b></div>`).join("") : `<p class="muted">Sin sesiones en el período.</p>`}
        <h3 style="margin-top:1rem">Alertas de asistencia</h3>${alerts.length ? alerts.map((s) => `<div class="${s.streak >= 3 ? "flag-bad" : "flag-warn"}">• ${esc(s.p.name)}: ${s.streak >= 3 ? s.streak + " ausencias seguidas" : "asistencia " + s.pct.toFixed(0) + "%"}</div>`).join("") : `<p class="muted">Ninguna.</p>`}</div>
    </div>
    <div class="card"><h3>Observaciones del entrenador</h3>${obs.length ? obs.map((s) => `<p><b>${s.session_date} · ${esc(s.title)}</b><br>${esc(s.notes)}</p>`).join("") : `<p class="muted">Sin observaciones en el período.</p>`}</div>`;
  $("#rg", pane).addEventListener("change", (e) => { T.range = e.target.value; renderReports(pane); });

  // carga semanal
  const w0 = addDays(monday(new Date()), -56), weeks = Array.from({ length: 13 }, (_, i) => addDays(w0, i * 7));
  const load = weeks.map((w) => real().filter((s) => s.session_date >= ymd(w) && s.session_date < ymd(addDays(w, 7))).reduce((t, s) => t + s.duration_min * s.intensity, 0));
  if (typeof Chart !== "undefined") {
    if (T.chart) T.chart.destroy();
    T.chart = new Chart($("#ld", pane), { type: "bar",
      data: { labels: weeks.map((w) => `${w.getDate()}/${w.getMonth() + 1}`), datasets: [{ data: load, backgroundColor: weeks.map((w) => (ymd(w) > today() ? "#19c3c366" : "#19c3c3")) }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#9db3d1" }, grid: { display: false } }, y: { ticks: { color: "#9db3d1" }, grid: { color: "#23497f" } } } } });
  }
  $("#csvs", pane).addEventListener("click", () => {
    const lines = [["Fecha", "Hora", "Título", "Objetivo", "Duración", "Intensidad", "Lugar", "Entrenador", "Convocados", "Presentes", "Observaciones"],
      ...past.sort((a, b) => a.session_date.localeCompare(b.session_date)).map((s) => { const a = T.att.filter((x) => x.session_id === s.id);
        return [s.session_date, (s.start_time || "").slice(0, 5), s.title, OBJ[s.objective], s.duration_min, s.intensity, s.location, s.coach, a.length, a.filter((x) => x.status === "presente").length, s.notes]; })];
    downloadText(`sesiones_${today()}.csv`, lines.map((r) => r.map(csvCell).join(",")).join("\n"));
  });
  $("#csvm", pane).addEventListener("click", () => {
    const ss = past.sort((a, b) => a.session_date.localeCompare(b.session_date));
    const lines = [["Jugador", ...ss.map((s) => `${s.session_date} ${s.title}`)],
      ...T.players.map((p) => [p.name, ...ss.map((s) => { const a = T.att.find((x) => x.session_id === s.id && x.player_id === p.id); return a ? ST[a.status] : ""; })])];
    downloadText(`matriz_asistencia_${today()}.csv`, lines.map((r) => r.map(csvCell).join(",")).join("\n"));
  });
}
