import { activePlayers } from "./players.js";
import { $, $$, esc, toast, openModal, downloadText, csvCell } from "./util.js";
import { TOOLS, TOOL_LABEL, PTS_TYPES, BOX_TYPES, POINT_TYPES, COLORS, createAnn, shapeSVG, handles, moveAnn, setHandle, hit, isVisible, cloneAnn, uuid } from "./video_draw.js";
import { putFile, getFile, delFile, storageEstimate, uploadCloud, downloadCloud, deleteCloud, CLOUD_LIMIT, fmtBytes } from "./video_store.js";

/* ===================== Visor y editor táctico de vídeo =====================
   Proyectos de vídeo con anotaciones sincronizadas con el tiempo, jugadas destacadas, escenas reutilizables,
   captura PNG y exportación WebM. Datos en Supabase; el archivo de vídeo en este navegador (IndexedDB) y, opcional, en la nube. */

const KINDS = { gol: "Gol", ocasion: "Ocasión", error_defensivo: "Error defensivo", presion: "Presión", transicion: "Transición", balon_parado: "Balón parado", otro: "Otro" };
const KIND_COL = { gol: "#2ecc71", ocasion: "#f5b041", error_defensivo: "#ec7063", presion: "#19c3c3", transicion: "#7fb3ff", balon_parado: "#c39bd3", otro: "#9db3d1" };
const DURS = [["1", "1 s"], ["3", "3 s"], ["5", "5 s"], ["10", "10 s"], ["frame", "Solo este fotograma"], ["all", "Todo el vídeo"]];
const LINKS = { partido: "Partido", entrenamiento: "Entrenamiento", jugador: "Jugador" };

const V = { sb: null, user: null, el: null, projects: [], players: [], matches: [], sessions: [], scenes: [], noSql: false };
let E = null; // estado del editor abierto
let keyHandler = null;

const fail = (error) => { if (error) { toast(error.message, "err"); return true; } return false; };
const tfmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };

/* ---------- carga ---------- */
async function loadAll() {
  const t = (n) => V.sb.from(n).select("*");
  const [p, sc, pl, ma, se] = await Promise.all([t("gm_video_projects"), t("gm_video_scenes"), activePlayers(V.sb), t("gm_matches"), t("gm_training_sessions")]);
  V.noSql = !!(p.error || sc.error);
  V.projects = (p.data || []).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  V.scenes = sc.data || [];
  V.players = (pl.data || []).sort((a, b) => a.name.localeCompare(b.name));
  V.matches = (ma.data || []).sort((a, b) => String(b.played_on || "").localeCompare(String(a.played_on || "")));
  V.sessions = (se.data || []).filter((s) => s.session_date).sort((a, b) => b.session_date.localeCompare(a.session_date));
}
const linkLabel = (p) => {
  if (!p.link_type) return "";
  if (p.link_type === "partido") { const m = V.matches.find((x) => x.id === p.link_id); return m ? `Partido vs ${m.opponent} (${m.played_on || ""})` : "Partido"; }
  if (p.link_type === "entrenamiento") { const s = V.sessions.find((x) => x.id === p.link_id); return s ? `Entrenamiento: ${s.title} (${s.session_date})` : "Entrenamiento"; }
  const j = V.players.find((x) => x.id === p.link_id); return j ? `Jugador: ${j.name}` : "Jugador";
};
const linkOptions = (type, cur) => (type === "partido" ? V.matches.map((m) => [m.id, `${m.played_on || ""} vs ${m.opponent}`]) : type === "entrenamiento" ? V.sessions.map((s) => [s.id, `${s.session_date} · ${s.title}`]) : type === "jugador" ? V.players.map((p) => [p.id, p.name]) : [])
  .map(([id, l]) => `<option value="${id}" ${cur === id ? "selected" : ""}>${esc(l)}</option>`).join("");

/* ======================= Punto de entrada ======================= */
export async function mountVideo(el, { sb, user }) {
  cleanup();
  V.sb = sb; V.user = user; V.el = el;
  el.innerHTML = `<p class="muted">Cargando…</p>`;
  await loadAll();
  renderList();
}

/* ======================= Lista de proyectos ======================= */
function renderList() {
  if (V.noSql) { V.el.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_video.sql</code> en el SQL Editor y recarga la página.</div>`; return; }
  V.el.innerHTML = `<div class="toolbar"><h2 style="margin:0">Vídeo táctico</h2><button class="btn" id="vnew">+ Nuevo proyecto</button></div>
    <p class="muted">Carga un vídeo (partido, entrenamiento, rival), dibuja flechas y zonas sobre él, marca jugadas y expórtalo. El archivo de vídeo se guarda en este navegador; las anotaciones y jugadas, en tu cuenta.</p>
    <div class="grid g2">${V.projects.map((p) => `<div class="card"><h3 style="margin-top:0">${esc(p.title)}</h3>
      <p class="muted">${esc(linkLabel(p)) || "Sin vincular"}<br>${p.file_name ? esc(p.file_name) + " · " + fmtBytes(p.file_size) : "Sin archivo"}${p.duration ? " · " + tfmt(p.duration) : ""}${p.cloud_path ? " · ☁ en la nube" : ""}</p>
      <div class="actions" style="justify-content:flex-start"><button class="btn" data-open="${p.id}">Abrir</button></div></div>`).join("") || `<div class="card muted">Aún no hay proyectos.</div>`}</div>`;
  $("#vnew", V.el).addEventListener("click", () => projectModal());
  $$("[data-open]", V.el).forEach((b) => b.addEventListener("click", () => openProject(b.dataset.open)));
}

/* Crear / editar proyecto (también panel de almacenamiento) */
async function projectModal(p) {
  const isNew = !p;
  const est = await storageEstimate();
  const hasLocal = p ? !!(await getFile(p.id).catch(() => null)) : false;
  const m = openModal(`<h2>${isNew ? "Nuevo proyecto de vídeo" : "Proyecto"} <button class="btn ghost sm" data-close>✕</button></h2>
    <label>Título</label><input id="pt" value="${esc(p?.title || "")}" placeholder="p. ej. Worthing vs Gillingham — análisis 1.ª parte">
    <div class="row"><div><label>Vincular a</label><select id="plt"><option value="">— nada —</option>${Object.entries(LINKS).map(([k, l]) => `<option value="${k}" ${p?.link_type === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label>&nbsp;</label><select id="pli">${linkOptions(p?.link_type, p?.link_id)}</select></div>
      <div><label>Fotogramas por segundo</label><input id="pfps" type="number" min="10" max="120" value="${p?.fps || 25}"></div></div>
    ${isNew ? `<label>Archivo de vídeo (mp4, webm…)</label><input type="file" id="pf" accept="video/*">` : ""}
    <label>Observaciones del analista</label><textarea id="pn" rows="4" style="width:100%">${esc(p?.notes || "")}</textarea>
    ${isNew ? "" : `<h3>Almacenamiento</h3>
      <p class="muted">En este dispositivo: <b>${hasLocal ? "sí" : "no"}</b>${p.file_name ? ` · ${esc(p.file_name)} (${fmtBytes(p.file_size)})` : ""}<br>
      En la nube: <b>${p.cloud_path ? "sí" : "no"}</b> (límite ${fmtBytes(CLOUD_LIMIT)} por archivo en el plan gratuito)<br>
      Espacio del navegador: ${est ? `${fmtBytes(est.used)} usados de ~${fmtBytes(est.quota)}` : "no disponible"}</p>
      <div class="toolbar"><button class="btn ghost sm" id="pup" ${hasLocal ? "" : "disabled"}>☁ Subir a la nube</button><button class="btn ghost sm" id="pdl" ${p.cloud_path ? "" : "disabled"}>⬇ Traer de la nube a este dispositivo</button>
        <button class="btn ghost sm" id="prc" ${p.cloud_path ? "" : "disabled"}>Quitar de la nube</button><button class="btn ghost sm" id="prl" ${hasLocal ? "" : "disabled"}>Quitar de este dispositivo</button></div>`}
    <div class="actions">${isNew ? "" : `<button class="btn danger sm" id="pdel" style="margin-right:auto">Eliminar proyecto</button>`}<button class="btn ghost" data-close>Cancelar</button><button class="btn" id="psave">Guardar</button></div>`);
  const typ = $("#plt", m.el), li = $("#pli", m.el);
  typ.addEventListener("change", () => (li.innerHTML = linkOptions(typ.value, null)));
  const fields = () => ({ title: $("#pt", m.el).value.trim(), link_type: typ.value || null, link_id: typ.value ? li.value || null : null, fps: Math.min(120, Math.max(10, +$("#pfps", m.el).value || 25)), notes: $("#pn", m.el).value.trim() || null });
  $("#psave", m.el).addEventListener("click", async () => {
    const f = fields(); if (!f.title) return toast("Pon un título.", "err");
    if (isNew) {
      const file = $("#pf", m.el).files[0];
      const { data, error } = await V.sb.from("gm_video_projects").insert({ ...f, file_name: file?.name || null, file_size: file?.size || null, file_modified: file?.lastModified || null }).select().single();
      if (fail(error)) return;
      if (file) { try { await putFile(data.id, file); navigator.storage?.persist?.(); } catch (e) { toast("No se pudo guardar el vídeo en este navegador: " + e.message, "err"); } }
      m.close(); await loadAll(); openProject(data.id);
    } else {
      const { error } = await V.sb.from("gm_video_projects").update({ ...f, updated_at: new Date().toISOString() }).eq("id", p.id);
      if (fail(error)) return;
      m.close(); await loadAll(); if (E?.p.id === p.id) { Object.assign(E.p, f); renderEditorShell(); } else renderList();
    }
  });
  if (isNew) return;
  $("#pdel", m.el).addEventListener("click", async () => {
    if (!confirm("¿Eliminar el proyecto con todas sus anotaciones y jugadas? No se puede deshacer.")) return;
    if (p.cloud_path) await deleteCloud(V.sb, p.cloud_path).catch(() => {});
    await delFile(p.id).catch(() => {});
    const { error } = await V.sb.from("gm_video_projects").delete().eq("id", p.id); if (fail(error)) return;
    m.close(); cleanup(); await loadAll(); renderList();
  });
  $("#pup", m.el).addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Subiendo…";
    try {
      const blob = await getFile(p.id); const file = new File([blob], p.file_name || "video.mp4", { type: blob.type });
      const path = await uploadCloud(V.sb, V.user.id, p.id, file);
      const { error } = await V.sb.from("gm_video_projects").update({ cloud_path: path }).eq("id", p.id); if (fail(error)) return;
      toast("Vídeo subido a la nube"); m.close(); await loadAll(); renderList();
    } catch (err) { toast(err.message, "err"); e.target.disabled = false; e.target.textContent = "☁ Subir a la nube"; }
  });
  $("#pdl", m.el).addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Descargando…";
    try { const blob = await downloadCloud(V.sb, p.cloud_path); await putFile(p.id, blob); toast("Vídeo guardado en este dispositivo"); m.close(); if (E?.p.id === p.id) openProject(p.id); }
    catch (err) { toast(err.message, "err"); e.target.disabled = false; }
  });
  $("#prc", m.el).addEventListener("click", async () => {
    if (!confirm("¿Quitar el vídeo de la nube? Las copias locales no se tocan.")) return;
    try { await deleteCloud(V.sb, p.cloud_path); } catch (err) { return toast(err.message, "err"); }
    await V.sb.from("gm_video_projects").update({ cloud_path: null }).eq("id", p.id); m.close(); await loadAll(); renderList();
  });
  $("#prl", m.el).addEventListener("click", async () => {
    if (!confirm("¿Quitar el vídeo de este dispositivo? Podrás volver a adjuntarlo o traerlo de la nube.")) return;
    await delFile(p.id); m.close(); if (E?.p.id === p.id) openProject(p.id); else renderList();
  });
}

/* ======================= Editor ======================= */
async function openProject(id) {
  cleanup();
  const p = V.projects.find((x) => x.id === id); if (!p) return;
  V.el.innerHTML = `<p class="muted">Abriendo proyecto…</p>`;
  const t = (n) => V.sb.from(n).select("*").eq("project_id", id);
  const [an, mo, li] = await Promise.all([t("gm_video_annotations"), t("gm_video_moments"), t("gm_video_lists")]);
  if (an.error || mo.error || li.error) { toast((an.error || mo.error || li.error).message, "err"); return renderList(); }
  const anns = (an.data || []).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))).map((r) => ({ id: r.id, type: r.type, data: r.data || {}, color: r.color, width: Number(r.width), t_start: Number(r.t_start), t_end: Number(r.t_end) }));
  let blob = null; try { blob = await getFile(id); } catch { /* sin IndexedDB */ }
  E = { p, anns, saved: new Map(anns.map((a) => [a.id, JSON.stringify(a)])), undo: [], redo: [], sel: null, tool: "select", color: COLORS[0], width: 4, fill: false, dur: "3", ver: 0, lastKey: "", showAll: false,
    moments: mo.data || [], lists: li.data || [], listF: "", kindF: "", tab: "anot", num: 1, drag: null, draft: null, g: { W: 1000, H: 562.5 }, status: "ok", saveTimer: null, url: blob ? URL.createObjectURL(blob) : null, hasFile: !!blob, root: null, raf: 0, lastT: -1, coalesce: { k: "", at: 0 } };
  renderEditorShell();
  keyHandler = onKey; document.addEventListener("keydown", keyHandler);
  E.raf = requestAnimationFrame(tick);
}
function cleanup() {
  if (keyHandler) document.removeEventListener("keydown", keyHandler); keyHandler = null;
  if (E) { cancelAnimationFrame(E.raf); if (E.saveTimer) { clearTimeout(E.saveTimer); save(); } if (E.url) URL.revokeObjectURL(E.url); }
  E = null;
}

function renderEditorShell() {
  const e = E, p = e.p;
  V.el.innerHTML = `<div class="toolbar"><button class="btn ghost sm" id="vback">← Proyectos</button><h2 style="margin:0">${esc(p.title)}</h2><span id="vsave" class="muted"></span>
      <span style="flex:1"></span><button class="btn ghost sm" id="vproj">⚙ Proyecto / almacenamiento</button><button class="btn ghost sm" id="vpng">📷 Capturar PNG</button><button class="btn ghost sm" id="vexp">🎞 Exportar WebM</button></div>
    <div class="vgrid"><div class="vleft">
      <div class="vtools" id="vtools">${TOOLS.map(([id, l, ic]) => `<button class="btn ghost sm ${e.tool === id ? "on" : ""}" data-tool="${id}" title="${l}">${ic} <span class="vtl">${l}</span></button>`).join("")}</div>
      <div class="vprops"><span class="muted">Color</span>${COLORS.map((c) => `<button class="vsw ${e.color === c ? "on" : ""}" data-col="${c}" style="background:${c}" title="${c}"></button>`).join("")}<input type="color" id="vcol" value="${e.color}" style="width:2.2rem;padding:0">
        <span class="muted">Grosor</span><input type="range" id="vw" min="2" max="14" value="${e.width}" style="width:90px">
        <label style="margin:0;color:inherit"><input type="checkbox" id="vfill" style="width:auto" ${e.fill ? "checked" : ""}> Relleno</label>
        <span class="muted">Visible durante</span><select id="vdur">${DURS.map(([k, l]) => `<option value="${k}" ${e.dur === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label style="margin:0;color:inherit"><input type="checkbox" id="vall" style="width:auto" ${e.showAll ? "checked" : ""}> Ver todas (tenues)</label></div>
      <div class="vstage" id="vstage" style="aspect-ratio:${e.g.W}/${e.g.H}">${e.url ? `<video id="vid" src="${e.url}" playsinline preload="auto"></video>` : `<div class="vnofile"><p>Este dispositivo no tiene el archivo de vídeo de este proyecto.</p>
          <input type="file" id="vattach" accept="video/*">${p.cloud_path ? `<p><button class="btn" id="vcloud">⬇ Traer de la nube</button></p>` : ""}${p.file_name ? `<p class="muted">Esperado: ${esc(p.file_name)} (${fmtBytes(p.file_size)})</p>` : ""}</div>`}
        <svg id="vsvg" viewBox="0 0 ${e.g.W} ${e.g.H}" preserveAspectRatio="none"></svg></div>
      <div class="vctrl"><button class="btn sm" id="vplay">▶</button><button class="btn ghost sm" data-seek="-5">−5 s</button><button class="btn ghost sm" data-frame="-1">◂ fot.</button><button class="btn ghost sm" data-frame="1">fot. ▸</button><button class="btn ghost sm" data-seek="5">+5 s</button>
        <input type="range" id="vseek" min="0" max="1000" value="0" style="flex:1;min-width:140px"><span id="vtime" class="muted">0:00.0</span>
        <select id="vrate" title="Velocidad">${[0.25, 0.5, 1, 1.5, 2].map((r) => `<option value="${r}" ${r === 1 ? "selected" : ""}>${r}×</option>`).join("")}</select><button class="btn ghost sm" id="vmute" title="Silencio">🔊</button></div>
      <div class="vtick" id="vtick"></div>
      <div class="toolbar"><button class="btn ghost sm" id="vundo">↶ Deshacer</button><button class="btn ghost sm" id="vredo">↷ Rehacer</button><button class="btn ghost sm" id="vclear">Limpiar fotograma</button><button class="btn" id="vmark">★ Marcar jugada (M)</button>
        <span class="muted">Atajos: Espacio ▶/⏸ · ←/→ fotograma · Supr borrar · Ctrl+Z/Y · Intro termina línea defensiva</span></div>
    </div><div class="vright"><div class="subtabs">${[["anot", "Anotaciones"], ["jug", "Jugadas"], ["esc", "Escenas"], ["not", "Notas"]].map(([k, l]) => `<button data-vt="${k}" class="${e.tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div id="vpane"></div></div></div>`;
  e.root = $("#vstage", V.el);
  $("#vback", V.el).addEventListener("click", async () => { await flush(); cleanup(); await loadAll(); renderList(); });
  $("#vproj", V.el).addEventListener("click", () => projectModal(e.p));
  $("#vpng", V.el).addEventListener("click", capturePNG);
  $("#vexp", V.el).addEventListener("click", exportModal);
  $$("[data-tool]", V.el).forEach((b) => b.addEventListener("click", () => { e.tool = b.dataset.tool; e.draft = null; if (e.tool !== "select") e.sel = null; $$("[data-tool]", V.el).forEach((x) => x.classList.toggle("on", x === b)); e.ver++; renderPane(); }));
  $$("[data-col]", V.el).forEach((b) => b.addEventListener("click", () => setColor(b.dataset.col)));
  $("#vcol", V.el).addEventListener("input", (ev) => setColor(ev.target.value));
  $("#vw", V.el).addEventListener("input", (ev) => { e.width = +ev.target.value; const a = selAnn(); if (a) mutate(() => (a.width = e.width), "w"); });
  $("#vfill", V.el).addEventListener("change", (ev) => { e.fill = ev.target.checked; const a = selAnn(); if (a && BOX_TYPES.has(a.type)) mutate(() => (a.data.fill = e.fill)); });
  $("#vdur", V.el).addEventListener("change", (ev) => (e.dur = ev.target.value));
  $("#vall", V.el).addEventListener("change", (ev) => { e.showAll = ev.target.checked; e.ver++; });
  $("#vundo", V.el).addEventListener("click", () => undo()); $("#vredo", V.el).addEventListener("click", () => redo());
  $("#vclear", V.el).addEventListener("click", clearFrame); $("#vmark", V.el).addEventListener("click", () => momentModal());
  $$("[data-vt]", V.el).forEach((b) => b.addEventListener("click", () => { e.tab = b.dataset.vt; $$("[data-vt]", V.el).forEach((x) => x.classList.toggle("on", x === b)); renderPane(); }));
  const vid = $("#vid", V.el);
  if (vid) {
    vid.addEventListener("loadedmetadata", () => {
      if (vid.videoWidth) { e.g = { W: 1000, H: (1000 * vid.videoHeight) / vid.videoWidth }; $("#vstage", V.el).style.aspectRatio = `${vid.videoWidth}/${vid.videoHeight}`; $("#vsvg", V.el).setAttribute("viewBox", `0 0 ${e.g.W} ${e.g.H}`); }
      if (vid.duration && Math.abs((e.p.duration || 0) - vid.duration) > 0.5) { e.p.duration = vid.duration; V.sb.from("gm_video_projects").update({ duration: vid.duration }).eq("id", e.p.id); }
      e.ver++; renderTicks();
    });
    $("#vplay", V.el).addEventListener("click", togglePlay);
    $$("[data-seek]", V.el).forEach((b) => b.addEventListener("click", () => seek(vid.currentTime + +b.dataset.seek)));
    $$("[data-frame]", V.el).forEach((b) => b.addEventListener("click", () => { vid.pause(); seek(vid.currentTime + +b.dataset.frame / e.p.fps); }));
    $("#vseek", V.el).addEventListener("input", (ev) => seek((+ev.target.value / 1000) * (vid.duration || 0)));
    $("#vrate", V.el).addEventListener("change", (ev) => (vid.playbackRate = +ev.target.value));
    $("#vmute", V.el).addEventListener("click", (ev) => { vid.muted = !vid.muted; ev.target.textContent = vid.muted ? "🔇" : "🔊"; });
    vid.addEventListener("play", () => ($("#vplay", V.el).textContent = "⏸")); vid.addEventListener("pause", () => ($("#vplay", V.el).textContent = "▶"));
    vid.addEventListener("error", () => toast("El navegador no puede reproducir este vídeo (prueba con mp4 H.264 o webm).", "err"));
    vid.addEventListener("click", togglePlay);
  } else {
    $("#vattach", V.el)?.addEventListener("change", attachFile);
    $("#vcloud", V.el)?.addEventListener("click", async (ev) => { ev.target.disabled = true; try { await putFile(e.p.id, await downloadCloud(V.sb, e.p.cloud_path)); openProject(e.p.id); } catch (err) { toast(err.message, "err"); ev.target.disabled = false; } });
  }
  bindStage();
  renderPane(); renderTicks(); updateSaveLabel();
}
async function attachFile(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const p = E.p;
  if (p.file_name && (f.name !== p.file_name || f.size !== p.file_size) && !confirm(`Este archivo (${f.name}, ${fmtBytes(f.size)}) no coincide con el original (${p.file_name}, ${fmtBytes(p.file_size)}). Las anotaciones podrían no cuadrar. ¿Usarlo igualmente?`)) return;
  try { await putFile(p.id, f); navigator.storage?.persist?.(); } catch (err) { return toast("No se pudo guardar el vídeo en este navegador: " + err.message, "err"); }
  await V.sb.from("gm_video_projects").update({ file_name: f.name, file_size: f.size, file_modified: f.lastModified }).eq("id", p.id);
  await loadAll(); openProject(p.id);
}

/* ---------- reproducción ---------- */
const vidEl = () => $("#vid", V.el);
function togglePlay() { const v = vidEl(); if (v) (v.paused ? v.play() : v.pause()); }
function seek(t) { const v = vidEl(); if (v) { v.currentTime = Math.min(Math.max(0, t), v.duration || 0); E.ver++; } }
const now = () => vidEl()?.currentTime || 0;
function tick() {
  if (!E) return;
  if (!document.body.contains(E.root)) { cleanup(); return; }
  const v = vidEl();
  if (v) {
    const t = v.currentTime;
    if (t !== E.lastT) { E.lastT = t; E.ver++; $("#vtime", V.el).textContent = `${tfmt(t)} / ${tfmt(v.duration)} · fot. ${Math.round(t * E.p.fps)}`; const sk = $("#vseek", V.el); if (sk && document.activeElement !== sk) sk.value = v.duration ? (t / v.duration) * 1000 : 0; }
    if (E.clipEnd != null && t >= E.clipEnd) { v.pause(); E.clipEnd = null; }
  }
  const key = E.ver;
  if (key !== E.lastKey) { E.lastKey = key; renderOverlay(); }
  E.raf = requestAnimationFrame(tick);
}

/* ---------- datos de anotaciones: mutación, deshacer, guardado ---------- */
const selAnn = () => E.anns.find((a) => a.id === E.sel) || null;
function pushUndo() { E.undo.push(JSON.stringify(E.anns)); if (E.undo.length > 100) E.undo.shift(); E.redo = []; }
function mutate(fn, coalesceKey) {
  const c = E.coalesce, t = Date.now();
  if (!(coalesceKey && c.k === coalesceKey && t - c.at < 900)) pushUndo();
  E.coalesce = { k: coalesceKey || "", at: t };
  fn(); E.ver++; scheduleSave();
}
function undo() { if (!E.undo.length) return; E.redo.push(JSON.stringify(E.anns)); E.anns = JSON.parse(E.undo.pop()); if (!selAnn()) E.sel = null; E.ver++; scheduleSave(); renderPane(); }
function redo() { if (!E.redo.length) return; E.undo.push(JSON.stringify(E.anns)); E.anns = JSON.parse(E.redo.pop()); if (!selAnn()) E.sel = null; E.ver++; scheduleSave(); renderPane(); }
function setColor(c) { E.color = c; $("#vcol", V.el).value = c; $$("[data-col]", V.el).forEach((b) => b.classList.toggle("on", b.dataset.col === c)); const a = selAnn(); if (a) mutate(() => (a.color = c), "c"); }
function scheduleSave() { E.status = "dirty"; updateSaveLabel(); clearTimeout(E.saveTimer); E.saveTimer = setTimeout(save, 700); }
function updateSaveLabel() { const l = $("#vsave", V.el); if (l) l.textContent = { ok: "✓ Guardado", dirty: "● Cambios sin guardar…", saving: "Guardando…", err: "⚠ Error al guardar (reintentando)" }[E.status]; }
async function flush() { if (E?.saveTimer) { clearTimeout(E.saveTimer); E.saveTimer = null; await save(); } }
async function save() {
  const e = E; if (!e) return; e.saveTimer = null; e.status = "saving"; updateSaveLabel();
  const cur = new Map(e.anns.map((a) => [a.id, JSON.stringify(a)]));
  const up = e.anns.filter((a) => e.saved.get(a.id) !== cur.get(a.id)), del = [...e.saved.keys()].filter((id) => !cur.has(id));
  try {
    for (let i = 0; i < up.length; i += 200) {
      const { error } = await V.sb.from("gm_video_annotations").upsert(up.slice(i, i + 200).map((a) => ({ id: a.id, project_id: e.p.id, type: a.type, data: a.data, color: a.color, width: a.width, t_start: a.t_start, t_end: a.t_end })), { onConflict: "id" });
      if (error) throw error;
    }
    if (del.length) { const { error } = await V.sb.from("gm_video_annotations").delete().in("id", del); if (error) throw error; }
    e.saved = cur; if (up.length || del.length) V.sb.from("gm_video_projects").update({ updated_at: new Date().toISOString() }).eq("id", e.p.id);
    e.status = e.saveTimer ? "dirty" : "ok";
  } catch (err) { e.status = "err"; toast("No se pudo guardar: " + err.message, "err"); e.saveTimer = setTimeout(save, 4000); }
  if (E === e) updateSaveLabel();
}
function clearFrame() {
  const t = now(), vis = E.anns.filter((a) => isVisible(a, t));
  if (!vis.length) return toast("No hay anotaciones en este fotograma.");
  if (!confirm(`¿Borrar las ${vis.length} anotaciones visibles en este instante?`)) return;
  mutate(() => { E.anns = E.anns.filter((a) => !vis.includes(a)); E.sel = null; }); renderPane();
}
function interval(t) {
  const d = E.dur, T = vidEl()?.duration || t + 5;
  if (d === "all") return [0, T]; if (d === "frame") return [t, t + 1 / E.p.fps];
  return [t, Math.min(T, t + Number(d))];
}

/* ---------- interacción con el lienzo ---------- */
function pt(ev) { const r = $("#vsvg", V.el).getBoundingClientRect(); return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))]; }
function bindStage() {
  const svg = $("#vsvg", V.el), e = E;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return;
    const v = vidEl(); const p = pt(ev), t = now();
    if (e.tool === "select") {
      const sel = selAnn(); let h = null;
      if (sel) for (const hd of handles(sel, e.g)) if (Math.hypot((hd.x - p[0]) * e.g.W, (hd.y - p[1]) * e.g.H) <= 16) h = hd;
      if (h) { e.drag = { mode: "handle", id: h.id, snap: JSON.stringify(e.anns), moved: false }; }
      else {
        const vis = e.anns.filter((a) => isVisible(a, t)).reverse().find((a) => hit(a, p[0], p[1], e.g));
        e.sel = vis ? vis.id : null; e.ver++; renderPane();
        if (vis) e.drag = { mode: "move", last: p, snap: JSON.stringify(e.anns), moved: false };
      }
    } else {
      v?.pause();
      const [t0, t1] = interval(t), base = { color: e.color, width: e.width, t_start: t0, t_end: t1, fill: e.fill, n: e.num };
      if (POINT_TYPES.has(e.tool)) { const a = createAnn(e.tool, p, p, e.g, base); if (e.tool === "number") e.num++; mutate(() => e.anns.push(a)); e.sel = a.id; renderPane(); return; }
      if (e.tool === "polyline") { if (!e.draft) e.draft = { type: "polyline", pts: [p], cur: p }; else e.draft.pts.push(p); e.ver++; return; }
      if (e.tool === "pen") e.draft = { type: "pen", pts: [p] };
      else e.draft = { type: e.tool, p0: p, p1: p, base };
    }
    svg.setPointerCapture(ev.pointerId); e.ver++;
  });
  svg.addEventListener("pointermove", (ev) => {
    const p = pt(ev);
    if (e.drag) {
      const sel = selAnn(); if (!sel) return;
      if (!e.drag.moved) { e.undo.push(e.drag.snap); if (e.undo.length > 100) e.undo.shift(); e.redo = []; e.drag.moved = true; }
      if (e.drag.mode === "move") { moveAnn(sel, p[0] - e.drag.last[0], p[1] - e.drag.last[1]); e.drag.last = p; } else setHandle(sel, e.drag.id, p[0], p[1]);
      e.ver++; return;
    }
    if (e.draft) {
      if (e.draft.type === "pen") e.draft.pts.push(p); else if (e.draft.type === "polyline") e.draft.cur = p; else e.draft.p1 = p;
      e.ver++;
    }
  });
  const end = (ev) => {
    if (e.drag) { if (e.drag.moved) scheduleSave(); e.drag = null; renderPane(); return; }
    const d = e.draft; if (!d || d.type === "polyline") return;
    e.draft = null;
    let a = null;
    if (d.type === "pen") { if (d.pts.length > 2) { const [t0, t1] = interval(now()); a = { id: uuid(), type: "pen", color: e.color, width: e.width, t_start: t0, t_end: t1, data: { pts: d.pts.filter((_, i) => i % 2 === 0 || i === d.pts.length - 1) } }; } }
    else if (Math.hypot((d.p1[0] - d.p0[0]) * e.g.W, (d.p1[1] - d.p0[1]) * e.g.H) > 12) a = createAnn(d.type, d.p0, d.p1, e.g, d.base);
    if (a) { mutate(() => e.anns.push(a)); e.sel = a.id; renderPane(); }
    e.ver++;
  };
  svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", () => finishPolyline());
}
function finishPolyline() {
  const d = E.draft; if (!d || d.type !== "polyline") return;
  E.draft = null;
  if (d.pts.length >= 2) { const [t0, t1] = interval(now()); const a = { id: uuid(), type: "polyline", color: E.color, width: E.width, t_start: t0, t_end: t1, data: { pts: d.pts } }; mutate(() => E.anns.push(a)); E.sel = a.id; renderPane(); }
  E.ver++;
}
function onKey(ev) {
  if (!E || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && ev.key !== "Escape") return;
  const k = ev.key.toLowerCase(), v = vidEl();
  if (k === " ") { ev.preventDefault(); togglePlay(); }
  else if (k === "arrowleft") { ev.preventDefault(); v?.pause(); seek(now() - (ev.shiftKey ? 1 : 1 / E.p.fps)); }
  else if (k === "arrowright") { ev.preventDefault(); v?.pause(); seek(now() + (ev.shiftKey ? 1 : 1 / E.p.fps)); }
  else if ((k === "delete" || k === "backspace") && E.sel) { ev.preventDefault(); const id = E.sel; mutate(() => (E.anns = E.anns.filter((a) => a.id !== id))); E.sel = null; renderPane(); }
  else if ((ev.ctrlKey || ev.metaKey) && k === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if ((ev.ctrlKey || ev.metaKey) && k === "y") { ev.preventDefault(); redo(); }
  else if (k === "enter") finishPolyline();
  else if (k === "escape") { E.draft = null; E.sel = null; E.ver++; renderPane(); }
  else if (k === "m" && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); momentModal(); }
}

/* ---------- dibujo del lienzo ---------- */
function overlaySVG(t, { handlesOn = false, ghosts = false } = {}) {
  const e = E, g = e.g, vis = e.anns.filter((a) => isVisible(a, t));
  let s = ghosts ? e.anns.filter((a) => !isVisible(a, t) && !a.data.hidden).map((a) => shapeSVG(a, g, { ghost: true })).join("") : "";
  s += vis.map((a) => shapeSVG(a, g)).join("");
  if (handlesOn) {
    const d = e.draft;
    if (d) {
      if (d.type === "polyline") s += shapeSVG({ id: "d", type: "polyline", color: e.color, width: e.width, data: { pts: [...d.pts, d.cur] } }, g);
      else if (d.type === "pen") s += shapeSVG({ id: "d", type: "pen", color: e.color, width: e.width, data: { pts: d.pts } }, g);
      else if (Math.hypot((d.p1[0] - d.p0[0]) * g.W, (d.p1[1] - d.p0[1]) * g.H) > 3) s += shapeSVG(createAnn(d.type, d.p0, d.p1, g, d.base), g);
    }
    const a = selAnn();
    if (a && vis.includes(a)) {
      s += handles(a, g).map((h) => `<circle cx="${h.x * g.W}" cy="${h.y * g.H}" r="9" fill="#fff" stroke="#19c3c3" stroke-width="3"/>`).join("");
      if (!handles(a, g).length) s += `<circle cx="${a.data.x * g.W}" cy="${a.data.y * g.H}" r="7" fill="none" stroke="#19c3c3" stroke-width="3"/>`;
      else if (BOX_TYPES.has(a.type)) s += `<rect x="${a.data.x * g.W}" y="${a.data.y * g.H}" width="${a.data.w * g.W}" height="${a.data.h * g.H}" fill="none" stroke="#19c3c3" stroke-width="1.5" stroke-dasharray="6 5"/>`;
    }
  }
  return s;
}
function renderOverlay() { const svg = $("#vsvg", V.el); if (svg) svg.innerHTML = overlaySVG(now(), { handlesOn: true, ghosts: E.showAll }); svg && (svg.style.cursor = E.tool === "select" ? "default" : "crosshair"); }

/* ---------- panel derecho ---------- */
function renderPane() {
  const pane = $("#vpane", V.el); if (!pane) return;
  ({ anot: paneAnn, jug: paneMoments, esc: paneScenes, not: paneNotes })[E.tab](pane);
}
function paneAnn(pane) {
  const e = E, a = selAnn(), d = a?.data || {};
  const sel = a ? `<div class="card"><b>${TOOL_LABEL[a.type]}</b> seleccionada
    ${"text" in d ? `<label>Texto</label><input id="stext" value="${esc(d.text)}">` : ""}${"n" in d ? `<label>Número</label><input id="snum" value="${esc(d.n)}">` : ""}
    ${"size" in d ? `<label>Tamaño</label><input id="ssize" type="range" min="14" max="80" value="${d.size}">` : ""}
    <div class="row"><div><label>Visible desde (s)</label><input id="sts" type="number" step="0.1" value="${a.t_start.toFixed(2)}"></div><div><label>hasta (s)</label><input id="ste" type="number" step="0.1" value="${a.t_end.toFixed(2)}"></div></div>
    <div class="toolbar"><button class="btn ghost sm" id="sn1">Inicio = ahora</button><button class="btn ghost sm" id="sn2">Fin = ahora</button><button class="btn ghost sm" id="sdup">Duplicar</button>
      <button class="btn ghost sm" id="shide">${d.hidden ? "Mostrar" : "Ocultar"}</button><button class="btn danger sm" id="sdel">Eliminar</button></div></div>` : `<p class="muted">Elige una herramienta y dibuja sobre el vídeo, o selecciona una anotación con ↖ para moverla, redimensionarla o cambiar sus tiempos.</p>`;
  const t = now();
  pane.innerHTML = `${sel}<b>Todas (${e.anns.length})</b><div class="vlist">${e.anns.map((x, i) => `<div class="vitem ${x.id === e.sel ? "on" : ""} ${isVisible(x, t) ? "" : "dim"}" data-a="${x.id}"><span class="vsw" style="background:${x.color}"></span> ${TOOL_LABEL[x.type]}${x.data.text ? ` «${esc(x.data.text)}»` : ""}<span class="muted"> ${tfmt(x.t_start)}–${tfmt(x.t_end)}${x.data.hidden ? " · oculta" : ""}</span></div>`).join("") || `<p class="muted">Sin anotaciones.</p>`}</div>`;
  $$("[data-a]", pane).forEach((r) => r.addEventListener("click", () => { E.tool = "select"; $$("[data-tool]", V.el).forEach((x) => x.classList.toggle("on", x.dataset.tool === "select")); E.sel = r.dataset.a; const x = selAnn(); if (x && !isVisible(x, now())) seek(x.t_start); E.ver++; renderPane(); }));
  if (!a) return;
  const bind = (id, fn, key) => $(id, pane)?.addEventListener("input", (ev) => mutate(() => fn(ev.target.value), key));
  bind("#stext", (v) => (a.data.text = v), "tx"); bind("#snum", (v) => (a.data.n = v), "nm"); bind("#ssize", (v) => (a.data.size = +v), "sz");
  bind("#sts", (v) => (a.t_start = Math.max(0, +v || 0)), "ts"); bind("#ste", (v) => (a.t_end = Math.max(a.t_start, +v || 0)), "te");
  $("#sn1", pane).addEventListener("click", () => { mutate(() => (a.t_start = Math.min(now(), a.t_end))); renderPane(); });
  $("#sn2", pane).addEventListener("click", () => { mutate(() => (a.t_end = Math.max(now(), a.t_start))); renderPane(); });
  $("#sdup", pane).addEventListener("click", () => { const c = cloneAnn(a); c.id = uuid(); moveAnn(c, 0.03, 0.03); mutate(() => e.anns.push(c)); e.sel = c.id; renderPane(); });
  $("#shide", pane).addEventListener("click", () => { mutate(() => (a.data.hidden = !a.data.hidden)); renderPane(); });
  $("#sdel", pane).addEventListener("click", () => { mutate(() => (e.anns = e.anns.filter((x) => x !== a))); e.sel = null; renderPane(); });
}

/* ---------- jugadas destacadas ---------- */
function paneMoments(pane) {
  const e = E;
  let ms = e.moments.filter((m) => (!e.kindF || m.kind === e.kindF) && (!e.listF || (e.listF === "-" ? !m.list_id : m.list_id === e.listF))).sort((a, b) => a.t - b.t);
  pane.innerHTML = `<div class="toolbar"><select id="mk"><option value="">Todos los tipos</option>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${e.kindF === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select id="ml"><option value="">Todas las listas</option><option value="-" ${e.listF === "-" ? "selected" : ""}>Sin lista</option>${e.lists.map((l) => `<option value="${l.id}" ${e.listF === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
    <button class="btn ghost sm" id="mnl">+ Lista</button><button class="btn ghost sm" id="mcsv">CSV</button></div>
    ${e.listF && e.listF !== "-" ? `<div class="toolbar"><button class="btn ghost sm" id="mrn">Renombrar lista</button><button class="btn ghost sm" id="mdl">Borrar lista</button></div>` : ""}
    <div class="vlist">${ms.map((m) => `<div class="vitem" data-m="${m.id}">${m.thumb ? `<img src="${m.thumb}" alt="">` : ""}<div><b style="color:${KIND_COL[m.kind]}">${KINDS[m.kind]}</b> · ${tfmt(m.t)}${m.t_end ? "–" + tfmt(m.t_end) : ""}
      ${m.player_id ? `<span class="muted"> · ${esc(V.players.find((p) => p.id === m.player_id)?.name || "")}</span>` : ""}<br><span class="muted">${esc(m.comment || "")}</span>${m.list_id ? `<br><span class="muted">📁 ${esc(e.lists.find((l) => l.id === m.list_id)?.name || "")}</span>` : ""}
      <div class="toolbar" style="margin:.3rem 0 0"><button class="btn ghost sm" data-go="${m.id}">${m.t_end ? "▶ Clip" : "Ir"}</button><button class="btn ghost sm" data-me="${m.id}">Editar</button></div></div></div>`).join("") || `<p class="muted">Sin jugadas. Pulsa ★ Marcar jugada (o M).</p>`}</div>`;
  $("#mk", pane).addEventListener("change", (ev) => { e.kindF = ev.target.value; renderPane(); });
  $("#ml", pane).addEventListener("change", (ev) => { e.listF = ev.target.value; renderPane(); });
  $("#mnl", pane).addEventListener("click", async () => { const n = prompt("Nombre de la lista:"); if (!n?.trim()) return; const { data, error } = await V.sb.from("gm_video_lists").insert({ project_id: e.p.id, name: n.trim() }).select().single(); if (fail(error)) return; e.lists.push(data); e.listF = data.id; renderPane(); });
  $("#mrn", pane)?.addEventListener("click", async () => { const l = e.lists.find((x) => x.id === e.listF); const n = prompt("Nuevo nombre:", l.name); if (!n?.trim()) return; const { error } = await V.sb.from("gm_video_lists").update({ name: n.trim() }).eq("id", l.id); if (!fail(error)) { l.name = n.trim(); renderPane(); } });
  $("#mdl", pane)?.addEventListener("click", async () => { if (!confirm("¿Borrar la lista? Las jugadas se conservan sin lista.")) return; const id = e.listF; const { error } = await V.sb.from("gm_video_lists").delete().eq("id", id); if (fail(error)) return; e.lists = e.lists.filter((l) => l.id !== id); e.moments.forEach((m) => { if (m.list_id === id) m.list_id = null; }); e.listF = ""; renderPane(); });
  $("#mcsv", pane).addEventListener("click", () => downloadText(`jugadas_${e.p.title.replace(/\W+/g, "_")}.csv`, [["inicio_s", "fin_s", "tipo", "jugador", "lista", "comentario"], ...ms.map((m) => [m.t.toFixed(1), m.t_end?.toFixed?.(1) ?? "", KINDS[m.kind], V.players.find((p) => p.id === m.player_id)?.name || "", e.lists.find((l) => l.id === m.list_id)?.name || "", m.comment || ""])].map((r) => r.map(csvCell).join(",")).join("\n")));
  $$("[data-go]", pane).forEach((b) => b.addEventListener("click", () => { const m = e.moments.find((x) => x.id === b.dataset.go), v = vidEl(); if (!v) return; seek(m.t); if (m.t_end) { e.clipEnd = m.t_end; v.play(); } }));
  $$("[data-me]", pane).forEach((b) => b.addEventListener("click", () => momentModal(e.moments.find((x) => x.id === b.dataset.me))));
}
async function captureThumb() {
  const v = vidEl(); if (!v?.videoWidth) return null;
  try { const c = document.createElement("canvas"); c.width = 480; c.height = Math.round((480 * v.videoHeight) / v.videoWidth); await drawFrame(c, true); return c.toDataURL("image/jpeg", 0.6); } catch { return null; }
}
function momentModal(m) {
  const e = E, v = vidEl(); if (!v && !m) return toast("Primero adjunta el vídeo.", "err");
  v?.pause();
  const t = m ? m.t : now();
  const md = openModal(`<h2>${m ? "Editar jugada" : "Marcar jugada"} <button class="btn ghost sm" data-close>✕</button></h2>
    <div class="row"><div><label>Tipo</label><select id="mkind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${m?.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label>Inicio (s)</label><input id="mt" type="number" step="0.1" value="${t.toFixed(1)}"></div><div><label>Fin del clip (s, opcional)</label><input id="mte" type="number" step="0.1" value="${m?.t_end ? m.t_end.toFixed(1) : ""}" placeholder="vacío = momento"></div></div>
    <div class="row"><div><label>Jugador implicado</label><select id="mp"><option value="">—</option>${V.players.map((p) => `<option value="${p.id}" ${m?.player_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div><label>Lista</label><select id="mli"><option value="">—</option>${e.lists.map((l) => `<option value="${l.id}" ${m?.list_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
    <label>Comentario</label><textarea id="mc" rows="3" style="width:100%">${esc(m?.comment || "")}</textarea>
    <div class="actions">${m ? `<button class="btn danger sm" id="mdel" style="margin-right:auto">Eliminar</button>` : ""}<button class="btn ghost" data-close>Cancelar</button><button class="btn" id="mok">Guardar</button></div>`);
  $("#mdel", md.el)?.addEventListener("click", async () => { const { error } = await V.sb.from("gm_video_moments").delete().eq("id", m.id); if (fail(error)) return; e.moments = e.moments.filter((x) => x.id !== m.id); md.close(); renderPane(); renderTicks(); });
  $("#mok", md.el).addEventListener("click", async () => {
    const tt = +$("#mt", md.el).value, te = $("#mte", md.el).value === "" ? null : +$("#mte", md.el).value;
    if (te != null && te <= tt) return toast("El fin del clip debe ser posterior al inicio.", "err");
    const row = { project_id: e.p.id, t: tt, t_end: te, kind: $("#mkind", md.el).value, comment: $("#mc", md.el).value.trim() || null, player_id: $("#mp", md.el).value || null, list_id: $("#mli", md.el).value || null };
    if (m) { const { error } = await V.sb.from("gm_video_moments").update(row).eq("id", m.id); if (fail(error)) return; Object.assign(m, row); }
    else { row.thumb = await captureThumb(); const { data, error } = await V.sb.from("gm_video_moments").insert(row).select().single(); if (fail(error)) return; e.moments.push(data); }
    md.close(); e.tab = "jug"; $$("[data-vt]", V.el).forEach((x) => x.classList.toggle("on", x.dataset.vt === "jug")); renderPane(); renderTicks();
  });
}
function renderTicks() {
  const el = $("#vtick", V.el), d = vidEl()?.duration; if (!el) return;
  el.innerHTML = d ? E.moments.map((m) => `<span class="vtk" style="left:${(m.t / d) * 100}%;${m.t_end ? `width:${((m.t_end - m.t) / d) * 100}%;` : ""}background:${KIND_COL[m.kind]}" title="${KINDS[m.kind]} ${tfmt(m.t)}" data-t="${m.t}"></span>`).join("") : "";
  $$("[data-t]", el).forEach((s) => s.addEventListener("click", () => seek(+s.dataset.t)));
}

/* ---------- escenas ---------- */
function paneScenes(pane) {
  pane.innerHTML = `<p class="muted">Una escena es un grupo de anotaciones reutilizable (p. ej. «salida de balón 4-3-3»). Se guardan con tiempos relativos y puedes insertarlas en cualquier vídeo, en el instante actual.</p>
    <button class="btn" id="scsave">Guardar lo visible ahora como escena</button>
    <div class="vlist">${V.scenes.map((s) => `<div class="vitem"><div><b>${esc(s.name)}</b> <span class="muted">${s.items.length} elementos</span><div class="toolbar" style="margin:.3rem 0 0"><button class="btn ghost sm" data-si="${s.id}">Insertar aquí</button><button class="btn ghost sm" data-sd="${s.id}">Borrar</button></div></div></div>`).join("") || `<p class="muted">Aún no hay escenas.</p>`}</div>`;
  $("#scsave", pane).addEventListener("click", async () => {
    const t = now(), items = E.anns.filter((a) => isVisible(a, t)); if (!items.length) return toast("No hay anotaciones visibles en este instante.", "err");
    const n = prompt("Nombre de la escena:"); if (!n?.trim()) return;
    const t0 = Math.min(...items.map((a) => a.t_start));
    const { data, error } = await V.sb.from("gm_video_scenes").insert({ name: n.trim(), items: items.map((a) => ({ ...cloneAnn(a), id: undefined, t_start: a.t_start - t0, t_end: a.t_end - t0 })) }).select().single();
    if (fail(error)) return; V.scenes.push(data); toast("Escena guardada"); renderPane();
  });
  $$("[data-si]", pane).forEach((b) => b.addEventListener("click", () => {
    const s = V.scenes.find((x) => x.id === b.dataset.si), t = now(), T = vidEl()?.duration || t + 60;
    mutate(() => s.items.forEach((it) => E.anns.push({ ...cloneAnn(it), id: uuid(), t_start: t + it.t_start, t_end: Math.min(T, t + it.t_end) }))); toast("Escena insertada"); renderPane();
  }));
  $$("[data-sd]", pane).forEach((b) => b.addEventListener("click", async () => { if (!confirm("¿Borrar la escena?")) return; const { error } = await V.sb.from("gm_video_scenes").delete().eq("id", b.dataset.sd); if (fail(error)) return; V.scenes = V.scenes.filter((x) => x.id !== b.dataset.sd); renderPane(); }));
}

/* ---------- notas ---------- */
function paneNotes(pane) {
  const p = E.p;
  pane.innerHTML = `<p class="muted">${esc(linkLabel(p)) || "Sin vincular a partido, entrenamiento o jugador (⚙ Proyecto)."}</p><label>Observaciones del analista</label><textarea id="nn" rows="12" style="width:100%">${esc(p.notes || "")}</textarea><p class="muted" id="ns"></p>`;
  const ta = $("#nn", pane);
  ta.addEventListener("blur", async () => { if ((ta.value.trim() || null) === (p.notes || null)) return; const notes = ta.value.trim() || null; const { error } = await V.sb.from("gm_video_projects").update({ notes, updated_at: new Date().toISOString() }).eq("id", p.id); if (fail(error)) return; p.notes = notes; $("#ns", pane).textContent = "✓ Guardado"; });
}

/* ---------- captura y exportación ---------- */
const svgImageCache = new Map();
function overlayImage(t, W, H, ghosts = false) {
  const body = overlaySVG(t, { ghosts }), key = body + W + "x" + H;
  if (svgImageCache.has(key)) return svgImageCache.get(key);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${E.g.W} ${E.g.H}" font-family="Inter,Arial,sans-serif">${body}</svg>`);
  const img = new Image(), p = new Promise((res) => { img.onload = () => res(img); img.onerror = () => res(null); }); img.src = url;
  if (svgImageCache.size > 30) svgImageCache.clear();
  svgImageCache.set(key, p); return p;
}
async function drawFrame(canvas, withOverlay = true) {
  const v = vidEl(), ctx = canvas.getContext("2d");
  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  if (withOverlay) { const im = await overlayImage(v.currentTime, canvas.width, canvas.height); if (im) ctx.drawImage(im, 0, 0, canvas.width, canvas.height); }
}
async function capturePNG() {
  const v = vidEl(); if (!v?.videoWidth) return toast("Primero adjunta el vídeo.", "err");
  v.pause();
  const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
  try { await drawFrame(c); } catch (err) { return toast("No se pudo capturar: " + err.message, "err"); }
  c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${E.p.title.replace(/\W+/g, "_")}_${v.currentTime.toFixed(1)}s.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, "image/png");
}
function exportModal() {
  const v = vidEl(); if (!v?.videoWidth) return toast("Primero adjunta el vídeo.", "err");
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return toast("Este navegador no permite exportar vídeo (usa Chrome, Edge o Firefox).", "err");
  const clips = E.moments.filter((m) => m.t_end);
  const md = openModal(`<h2>Exportar vídeo con anotaciones <button class="btn ghost sm" data-close>✕</button></h2>
    <p class="muted">Se graba en tiempo real a partir del vídeo y sus anotaciones, y se descarga como <b>.webm</b>. Tarda lo mismo que dure el tramo y el vídeo se reproducirá mientras tanto. Mantén esta pestaña visible.</p>
    <label>Tramo</label><select id="xr"><option value="all">Todo el vídeo (${tfmt(v.duration)})</option>${clips.map((m) => `<option value="${m.id}">Clip: ${KINDS[m.kind]} ${tfmt(m.t)}–${tfmt(m.t_end)}</option>`).join("")}</select>
    <div id="xs" class="muted" style="margin:.6rem 0"></div><div class="actions"><button class="btn ghost" id="xc">Cerrar</button><button class="btn" id="xg">Grabar y descargar</button></div>`);
  let cancel = false;
  $("#xc", md.el).addEventListener("click", () => { cancel = true; md.close(); });
  $("#xg", md.el).addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    const sel = $("#xr", md.el).value, m = clips.find((x) => x.id === sel), t0 = m ? m.t : 0, t1 = m ? m.t_end : v.duration;
    const sc = Math.min(1, 1280 / v.videoWidth), c = document.createElement("canvas"); c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
    const stream = c.captureStream(30);
    try { const as = (v.captureStream ? v.captureStream() : v.mozCaptureStream?.())?.getAudioTracks() || []; as.forEach((tr) => stream.addTrack(tr)); } catch { /* sin audio */ }
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : {}), chunks = [];
    rec.ondataavailable = (d) => d.data.size && chunks.push(d.data);
    const prevRate = v.playbackRate, prevMuted = v.muted;
    v.pause(); v.playbackRate = 1; seek(t0); await new Promise((r) => { const f = () => { v.removeEventListener("seeked", f); r(); }; v.addEventListener("seeked", f); setTimeout(r, 1500); });
    const done = new Promise((r) => (rec.onstop = r)); rec.start(500);
    await v.play();
    let ln = null;
    while (!cancel && !v.ended && v.currentTime < t1) {
      const ctx = c.getContext("2d"); ctx.drawImage(v, 0, 0, c.width, c.height);
      const p = overlayImage(v.currentTime, c.width, c.height); p.then((im) => (ln = im)); if (ln) ctx.drawImage(ln, 0, 0, c.width, c.height);
      $("#xs", md.el) && ($("#xs", md.el).textContent = `Grabando… ${Math.round(((v.currentTime - t0) / Math.max(0.1, t1 - t0)) * 100)} %`);
      await new Promise((r) => requestAnimationFrame(r));
    }
    v.pause(); rec.state !== "inactive" && rec.stop(); await done; v.playbackRate = prevRate; v.muted = prevMuted;
    if (!cancel && chunks.length) { const blob = new Blob(chunks, { type: "video/webm" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${E.p.title.replace(/\W+/g, "_")}${m ? "_clip" : ""}.webm`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("Exportado " + fmtBytes(blob.size)); }
    md.close();
  });
}
