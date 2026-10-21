import { $, $$, esc, toNum, toast } from "./util.js";

/* Pestañas "Temporada" (estadísticas de fin de temporada) y "Clasificación" (tabla de liga).
   Todo se escribe a mano o se pega desde Excel/Google Sheets al terminar cada temporada. */

const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const STAT_COLS = [
  ["apps", "PJ"], ["minutes", "Min"], ["goals", "G"], ["assists", "A"], ["clean_sheets", "PI"], ["avg_rating", "Nota"],
];
const STAT_ALIASES = {
  name: ["nombre", "name", "jugador", "player"],
  apps: ["pj", "apps", "partidos", "games", "matches", "appearances", "played"],
  minutes: ["min", "minutos", "minutes"],
  goals: ["g", "goles", "goals"],
  assists: ["a", "asistencias", "assists", "ast"],
  clean_sheets: ["pi", "imbatidas", "porterias imbatidas", "clean sheets", "clean_sheets", "cs"],
  avg_rating: ["nota", "rating", "media", "avg", "nota media", "avg_rating"],
};
const TABLE_COLS = [
  ["pos", "Pos"], ["team", "Equipo"], ["played", "PJ"], ["won", "G"], ["drawn", "E"], ["lost", "P"],
  ["gf", "GF"], ["ga", "GC"], ["points", "Pts"],
];
const TABLE_ALIASES = {
  pos: ["pos", "#", "posicion", "puesto", "position"],
  team: ["equipo", "team", "club", "nombre", "name"],
  played: ["pj", "played", "partidos", "pld", "mp", "games"],
  won: ["g", "w", "won", "ganados", "victorias", "pg"],
  drawn: ["e", "d", "drawn", "empatados", "empates", "pe"],
  lost: ["p", "l", "lost", "perdidos", "derrotas", "pp"],
  gf: ["gf", "f", "goles a favor", "for"],
  ga: ["gc", "ga", "goles en contra", "against"],
  points: ["pts", "puntos", "points", "pt"],
};

/* ---------- utilidades ---------- */
export function seasonList(ctx) {
  const set = new Set([...ctx.seasonStats.map((r) => r.season), ...ctx.table.map((r) => r.season)]);
  if (ctx.season) set.add(ctx.season);
  return [...set].sort().reverse();
}

function defaultSeasonName() {
  const y = new Date().getFullYear();
  return `${y}/${String((y + 1) % 100).padStart(2, "0")}`;
}

function seasonBar(ctx, rerender) {
  const list = seasonList(ctx);
  const html = `<div class="toolbar">
    <label style="margin:0">Temporada</label>
    <select id="sn">${list.map((s) => `<option ${s === ctx.season ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
    <button class="btn ghost sm" id="sn-new">+ Nueva temporada</button></div>`;
  const bind = (pane) => {
    $("#sn", pane)?.addEventListener("change", (e) => { ctx.season = e.target.value; rerender(); });
    $("#sn-new", pane).addEventListener("click", () => {
      const n = (prompt("Nombre de la temporada (ej. 2026/27):", defaultSeasonName()) || "").trim();
      if (!n) return;
      ctx.season = n;
      rerender();
    });
  };
  return { html, bind };
}

// Lee texto pegado (Excel / Sheets / CSV) → filas con claves internas según alias
function parsePaste(text, aliases) {
  const res = Papa.parse(String(text).trim(), { header: true, skipEmptyLines: true });
  const lookup = {};
  for (const [f, names] of Object.entries(aliases)) for (const n of names) if (!(norm(n) in lookup)) lookup[norm(n)] = f;
  const rows = res.data.map((raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      const f = lookup[norm(k)];
      if (f && v !== "" && v != null) out[f] = String(v).trim();
    }
    return out;
  });
  return rows;
}

/* ======================= Estadísticas de temporada ======================= */
export function renderSeason(pane, ctx) {
  const rerender = () => renderSeason(pane, ctx);
  const bar = seasonBar(ctx, rerender);
  if (ctx.noSeasonSql) {
    pane.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_temporadas.sql</code> en el SQL Editor y recarga la página.</div>`;
    return;
  }
  if (!ctx.players.length) {
    pane.innerHTML = `<div class="card muted">Primero añade o importa jugadores en la pestaña Jugadores.</div>`;
    return;
  }
  const season = ctx.season;
  const cur = new Map(ctx.seasonStats.filter((r) => r.season === season).map((r) => [r.player_id, r]));
  const players = [...ctx.players].sort((a, b) => (b.overall || 0) - (a.overall || 0) || a.name.localeCompare(b.name));
  const val = (id, k) => { const v = cur.get(id)?.[k]; return v == null ? "" : v; };

  pane.innerHTML = `${bar.html}
    <div class="card">
      <b>Estadísticas de ${esc(season)}</b> — anótalas al terminar la temporada (puedes dejar en blanco a quien no jugó).
      Estos números se suman al total del jugador junto con el acumulado previo.
      <details style="margin-top:.5rem"><summary class="muted" style="cursor:pointer">Pegar desde Excel / Google Sheets</summary>
        <p class="muted">Copia las celdas incluyendo la fila de títulos (nombre, PJ, Min, G, A, PI, Nota) y pégalas aquí. Solo se rellena la tabla; guardas tú después.</p>
        <textarea id="paste" rows="5" style="width:100%" placeholder="nombre&#9;pj&#9;min&#9;g&#9;a&#9;pi&#9;nota"></textarea>
        <button class="btn ghost sm" id="apply">Rellenar tabla</button> <span id="pmsg" class="muted"></span>
      </details>
    </div>
    <div class="tw"><table><thead><tr><th>Jugador</th><th>Pos</th>${STAT_COLS.map(([, l]) => `<th class="num">${l}</th>`).join("")}</tr></thead>
    <tbody>${players.map((p) => `<tr data-p="${p.id}"><td><b>${esc(p.name)}</b></td><td><span class="pos">${esc(p.position || "–")}</span></td>
      ${STAT_COLS.map(([k]) => `<td><input class="v" data-k="${k}" type="number" min="0" ${k === "avg_rating" ? 'max="10" step="0.1"' : 'step="1"'}
        value="${val(p.id, k)}" style="width:${k === "minutes" ? 78 : 64}px"></td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr id="tot"><td colspan="2"><b>Totales</b></td>${STAT_COLS.map(([k]) => `<td class="num" data-t="${k}"></td>`).join("")}</tr></tfoot></table></div>
    <div id="chk" class="muted" style="margin:.5rem 0"></div>
    <div class="actions"><button class="btn" id="save">Guardar ${esc(season)}</button></div>`;
  bar.bind(pane);

  const teamGoals = ctx.table.find((r) => r.season === season && r.is_mine)?.gf;
  const totals = () => {
    const t = {};
    $$("tbody tr", pane).forEach((tr) => $$(".v", tr).forEach((i) => { if (i.dataset.k !== "avg_rating") t[i.dataset.k] = (t[i.dataset.k] || 0) + (Number(i.value) || 0); }));
    $$("[data-t]", pane).forEach((td) => { td.textContent = td.dataset.t === "avg_rating" ? "" : (t[td.dataset.t] || 0); });
    $("#chk", pane).textContent = teamGoals != null
      ? `Goles de jugadores: ${t.goals || 0} · goles del equipo en la clasificación: ${teamGoals}${(t.goals || 0) > teamGoals ? " ⚠ los jugadores suman más que el equipo" : ""}`
      : "";
  };
  pane.addEventListener("input", (e) => { if (e.target.classList.contains("v")) totals(); });
  totals();

  $("#apply", pane).addEventListener("click", () => {
    const rows = parsePaste($("#paste", pane).value, STAT_ALIASES);
    if (!rows.length) return toast("No encontré filas. Incluye la fila de títulos.", "err");
    const byName = new Map(ctx.players.map((p) => [norm(p.name), p.id]));
    let ok = 0; const miss = [];
    for (const r of rows) {
      const id = byName.get(norm(r.name));
      if (!id) { if (r.name) miss.push(r.name); continue; }
      const tr = $(`tr[data-p="${id}"]`, pane);
      for (const [k] of STAT_COLS) {
        if (r[k] == null) continue;
        const n = toNum(r[k]);
        if (n !== null) $(`.v[data-k="${k}"]`, tr).value = n;
      }
      ok++;
    }
    totals();
    $("#pmsg", pane).textContent = `${ok} jugadores rellenados.` + (miss.length ? ` No coinciden: ${miss.slice(0, 8).join(", ")}${miss.length > 8 ? "…" : ""} (el nombre debe ser igual al de la plantilla).` : "");
  });

  $("#save", pane).addEventListener("click", async (e) => {
    const rows = [], del = [];
    let bad = null;
    $$("tbody tr", pane).forEach((tr) => {
      const id = tr.dataset.p;
      const o = {};
      $$(".v", tr).forEach((i) => { o[i.dataset.k] = i.value === "" ? null : Number(i.value); });
      const has = STAT_COLS.some(([k]) => o[k] != null && (k === "avg_rating" || o[k] > 0));
      const name = ctx.players.find((p) => p.id === id)?.name;
      if (has) {
        if (o.avg_rating != null && (o.avg_rating < 0 || o.avg_rating > 10)) bad = `${name}: la nota debe estar entre 0 y 10.`;
        if ((o.minutes || 0) > (o.apps || 0) * 130) bad = `${name}: tiene más minutos de los posibles para ${o.apps || 0} partidos.`;
        rows.push({ user_id: ctx.user.id, player_id: id, season: ctx.season, apps: o.apps || 0, minutes: o.minutes || 0,
          goals: o.goals || 0, assists: o.assists || 0, clean_sheets: o.clean_sheets || 0, avg_rating: o.avg_rating });
      } else if (cur.get(id)) del.push(cur.get(id).id);
    });
    if (bad) return toast(bad, "err");
    e.target.disabled = true;
    if (del.length) {
      const { error } = await ctx.sb.from("gm_season_stats").delete().in("id", del);
      if (error) { e.target.disabled = false; return toast(error.message, "err"); }
    }
    if (rows.length) {
      const { error } = await ctx.sb.from("gm_season_stats").upsert(rows, { onConflict: "player_id,season" });
      if (error) { e.target.disabled = false; return toast(error.message, "err"); }
    }
    toast(`Temporada ${ctx.season} guardada (${rows.length} jugadores)`);
    ctx.reload();
  });
}

/* ======================= Clasificación ======================= */
const isMine = (t) => /worthing/i.test(t || "");

export function renderLeague(pane, ctx) {
  const rerender = () => renderLeague(pane, ctx);
  const bar = seasonBar(ctx, rerender);
  if (ctx.noSeasonSql) {
    pane.innerHTML = `<div class="card"><b>Falta un paso en Supabase.</b> Ejecuta <code>supabase/schema_temporadas.sql</code> en el SQL Editor y recarga la página.</div>`;
    return;
  }
  const season = ctx.season;
  const saved = ctx.table.filter((r) => r.season === season).sort((a, b) => a.pos - b.pos);
  const N = Math.max(saved.length, 24);
  const rows = Array.from({ length: N }, (_, i) => saved[i] || { pos: i + 1, team: "" });
  const zone = (pos) => (pos <= 3 ? "flag-ok" : pos <= 7 ? "best" : pos >= 21 ? "flag-bad" : "");
  const mine = saved.find((r) => r.is_mine || isMine(r.team));

  pane.innerHTML = `${bar.html}
    ${mine ? `<div class="card"><b>${esc(mine.team)}</b>: puesto <b>${mine.pos}</b> · ${mine.points} pts · ${mine.won}G ${mine.drawn}E ${mine.lost}P · GF ${mine.gf} / GC ${mine.ga} (dif. ${mine.gf - mine.ga > 0 ? "+" : ""}${mine.gf - mine.ga})</div>` : ""}
    <div class="card">
      <b>Clasificación final de ${esc(season)}</b> — EFL League Two: 1–3 ascenso directo, 4–7 play-offs, 21–24 descenso.
      <details style="margin-top:.5rem"><summary class="muted" style="cursor:pointer">Pegar desde Excel / Google Sheets</summary>
        <p class="muted">Pega la tabla con títulos (Pos, Equipo, PJ, G, E, P, GF, GC, Pts). Si faltan los puntos, se calculan (3 por victoria + 1 por empate).</p>
        <textarea id="paste" rows="5" style="width:100%" placeholder="pos&#9;equipo&#9;pj&#9;g&#9;e&#9;p&#9;gf&#9;gc&#9;pts"></textarea>
        <button class="btn ghost sm" id="apply">Rellenar tabla</button>
      </details>
    </div>
    <div class="tw"><table id="lt"><thead><tr>${TABLE_COLS.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">DG</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr data-i="${i}">
      <td class="num ${zone(i + 1)}"><b>${i + 1}</b></td>
      <td><input class="t" data-k="team" value="${esc(r.team || "")}" style="min-width:190px"></td>
      ${["played", "won", "drawn", "lost", "gf", "ga", "points"].map((k) => `<td><input class="t" data-k="${k}" type="number" min="0" value="${r[k] ?? ""}" style="width:60px"></td>`).join("")}
      <td class="num dg"></td></tr>`).join("")}</tbody></table></div>
    <div class="actions"><button class="btn ghost" id="more">+ Fila</button><button class="btn" id="save">Guardar clasificación ${esc(season)}</button></div>`;
  bar.bind(pane);

  const calcDG = () => $$("#lt tbody tr", pane).forEach((tr) => {
    const gf = $('[data-k="gf"]', tr).value, ga = $('[data-k="ga"]', tr).value;
    $(".dg", tr).textContent = gf !== "" && ga !== "" ? Number(gf) - Number(ga) : "";
  });
  pane.addEventListener("input", (e) => { if (e.target.classList.contains("t")) calcDG(); });
  calcDG();

  $("#more", pane).addEventListener("click", () => {
    const tb = $("#lt tbody", pane), n = tb.rows.length + 1;
    const tr = document.createElement("tr");
    tr.dataset.i = n - 1;
    tr.innerHTML = `<td class="num"><b>${n}</b></td><td><input class="t" data-k="team" style="min-width:190px"></td>` +
      ["played", "won", "drawn", "lost", "gf", "ga", "points"].map((k) => `<td><input class="t" data-k="${k}" type="number" min="0" style="width:60px"></td>`).join("") + `<td class="num dg"></td>`;
    tb.appendChild(tr);
  });

  $("#apply", pane).addEventListener("click", () => {
    const parsed = parsePaste($("#paste", pane).value, TABLE_ALIASES);
    if (!parsed.length) return toast("No encontré filas. Incluye la fila de títulos.", "err");
    // ordenar por la columna Pos si viene; si no, por el orden pegado
    const list = parsed.filter((r) => r.team).map((r, i) => ({ ...r, _o: r.pos ? Number(r.pos) : i + 1 })).sort((a, b) => a._o - b._o);
    const tb = $("#lt tbody", pane);
    while (tb.rows.length < list.length) $("#more", pane).click();
    list.forEach((r, i) => {
      const tr = tb.rows[i];
      $('[data-k="team"]', tr).value = r.team;
      for (const k of ["played", "won", "drawn", "lost", "gf", "ga", "points"]) {
        const n = r[k] != null ? toNum(r[k]) : null;
        $(`[data-k="${k}"]`, tr).value = n ?? "";
      }
    });
    calcDG();
    toast(`${list.length} equipos pegados. Revisa y guarda.`);
  });

  $("#save", pane).addEventListener("click", async (e) => {
    const out = [];
    let bad = null;
    $$("#lt tbody tr", pane).forEach((tr, i) => {
      const g = (k) => $(`[data-k="${k}"]`, tr).value.trim();
      const team = g("team");
      if (!team) return;
      const n = (k) => (g(k) === "" ? 0 : Number(g(k)));
      const row = { user_id: ctx.user.id, season: ctx.season, pos: i + 1, team, played: n("played"), won: n("won"),
        drawn: n("drawn"), lost: n("lost"), gf: n("gf"), ga: n("ga"), points: g("points") === "" ? 3 * n("won") + n("drawn") : n("points"),
        is_mine: isMine(team) };
      if (row.played === 0 && (row.won || row.drawn || row.lost)) row.played = row.won + row.drawn + row.lost;
      if (row.played !== row.won + row.drawn + row.lost) bad = `${team}: PJ (${row.played}) no coincide con G+E+P (${row.won + row.drawn + row.lost}).`;
      out.push(row);
    });
    if (!out.length) return toast("No hay equipos para guardar.", "err");
    if (bad) return toast(bad, "err");
    if (new Set(out.map((r) => r.team.toLowerCase())).size !== out.length) return toast("Hay equipos repetidos.", "err");
    e.target.disabled = true;
    const keep = out.map((r) => r.team);
    const gone = saved.filter((r) => !keep.includes(r.team)).map((r) => r.id);
    if (gone.length) {
      const { error } = await ctx.sb.from("gm_league_table").delete().in("id", gone);
      if (error) { e.target.disabled = false; return toast(error.message, "err"); }
    }
    const { error } = await ctx.sb.from("gm_league_table").upsert(out, { onConflict: "user_id,season,team" });
    if (error) { e.target.disabled = false; return toast(error.message, "err"); }
    toast("Clasificación guardada");
    ctx.reload();
  });
}
