import { $, $$, esc, toast, openModal } from "./util.js";

/* ===================== Pizarra táctica =====================
   Un solo editor para dos secciones: "tactica" y "pelota_parada".
   Campo 105 × 68 m. Mi equipo (turquesa) ataca hacia la derecha; el rival (rojo) hacia la izquierda. */

const W = 105, H = 68;
const GROUP = { GK: "gk", CB: "def", LB: "def", RB: "def", LWB: "def", RWB: "def", CDM: "mid", CM: "mid", CAM: "mid", LM: "mid", RM: "mid", LW: "att", RW: "att", CF: "att", ST: "att" };
const SIDE = { LB: 0, LWB: 0, LM: 0, LW: 0, RB: 2, RWB: 2, RM: 2, RW: 2 };
const FORMATIONS = ["4-4-2", "4-3-3", "4-2-3-1", "4-1-4-1", "4-5-1", "4-1-2-1-2", "3-5-2", "3-4-3", "5-3-2", "5-4-1"];
const TOOLS = [
  ["select", "☝ Mover"], ["arrow", "➜ Pase"], ["run", "⇢ Desmarque"], ["zone", "▭ Zona"], ["ellipse", "◯ Zona"],
  ["link", "🔗 Unir"], ["erase", "✖ Borrar"],
];
const COL = { me: "#19c3c3", rival: "#ec7063" };

/* ---------- Formaciones ---------- */
function slots(f) {
  const lines = f.split("-").map(Number), n = lines.length;
  const out = [{ g: "gk", nx: 0, ny: 0.5 }];
  lines.forEach((c, li) => {
    const nx = 0.2 + (0.7 * li) / (n - 1);
    const g = li === 0 ? "def" : li === n - 1 ? "att" : "mid";
    for (let i = 0; i < c; i++) out.push({ g, nx, ny: 0.1 + (0.8 * (i + 0.5)) / c, line: li });
  });
  return out;
}
const slotXY = (team, s) => {
  const x = 5 + s.nx * 58, y = s.ny * H;
  return team === "me" ? [x, y] : [W - x, H - y];
};

function newState() {
  const B = { players: [], ball: { x: W / 2, y: H / 2 }, items: [], frames: [], fMe: "4-4-2", fRiv: "4-3-3" };
  for (let i = 0; i < 11; i++) {
    B.players.push({ id: "m" + i, team: "me", x: 0, y: 0, num: i + 1, name: "", pid: null });
    B.players.push({ id: "r" + i, team: "rival", x: 0, y: 0, num: i + 1, name: "Rival " + (i + 1), pid: null });
  }
  applyFormation(B, "me", B.fMe);
  applyFormation(B, "rival", B.fRiv);
  return B;
}
function applyFormation(B, team, f) {
  const ss = slots(f), ps = B.players.filter((p) => p.team === team);
  ps.forEach((p, i) => { const [x, y] = slotXY(team, ss[i]); p.x = x; p.y = y; });
  if (team === "me") B.fMe = f; else B.fRiv = f;
}

// Mi mejor once: por cada hueco elige al mejor jugador libre de su grupo, y ordena cada línea de izquierda a derecha.
function autoFill(B, squad) {
  const ss = slots(B.fMe), used = new Set(), mine = B.players.filter((p) => p.team === "me");
  const pool = [...squad].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const pick = (g) => {
    const p = pool.find((x) => !used.has(x.id) && GROUP[x.position] === g) || pool.find((x) => !used.has(x.id));
    if (p) used.add(p.id);
    return p;
  };
  const chosen = ss.map((s) => pick(s.g));
  const byLine = {};
  ss.forEach((s, i) => { (byLine[s.line ?? -1] ||= []).push(i); });
  for (const idxs of Object.values(byLine)) {
    const items = idxs.map((i) => chosen[i]);
    const ord = items.map((p, k) => [p ? SIDE[p.position] ?? 1 : 1, k]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    idxs.forEach((slotIdx, k) => { chosen[slotIdx] = items[ord[k][1]]; });
  }
  mine.forEach((tk, i) => {
    const p = chosen[i];
    tk.pid = p?.id || null; tk.name = p?.name || ""; if (p?.shirt_number) tk.num = p.shirt_number;
  });
}

/* ---------- Geometría: Voronoi y superioridades ---------- */
function clip(poly, a, b, c) { // conserva a·x + b·y <= c
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}
function voronoi(players) {
  return players.map((p, i) => {
    let poly = [[0, 0], [W, 0], [W, H], [0, H]];
    for (let j = 0; j < players.length && poly.length; j++) {
      if (i === j) continue;
      const q = players[j], dx = q.x - p.x, dy = q.y - p.y;
      if (dx === 0 && dy === 0) continue;
      poly = clip(poly, dx, dy, (dx * (p.x + q.x) + dy * (p.y + q.y)) / 2);
    }
    return { p, poly };
  });
}
const area = (poly) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

const THIRDS = ["tercio defensivo", "mediocampo", "tercio de ataque"];
const CHANNELS = ["banda izquierda", "carril central", "banda derecha"];
function superiority(players, ball) {
  const cells = [];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    const x0 = (W / 3) * c, x1 = x0 + W / 3, y0 = (H / 3) * r, y1 = y0 + H / 3;
    const inside = (p) => p.x >= x0 && p.x < x1 + (c === 2 ? 1 : 0) && p.y >= y0 && p.y < y1 + (r === 2 ? 1 : 0);
    const me = players.filter((p) => p.team === "me" && inside(p)).length;
    const rv = players.filter((p) => p.team === "rival" && inside(p)).length;
    cells.push({ x0, y0, w: W / 3, h: H / 3, me, rv, d: me - rv, name: `${THIRDS[c]} · ${CHANNELS[r]}` });
  }
  const near = (t) => players.filter((p) => p.team === t && Math.hypot(p.x - ball.x, p.y - ball.y) <= 15).length;
  return { cells, ballMe: near("me"), ballRv: near("rival") };
}

/* ---------- Presets de balón parado (mi equipo ataca a la derecha) ---------- */
const PRESETS = {
  corner: { label: "Córner", ball: [104, 1.5],
    me: [[5, 34], [44, 20], [44, 48], [52, 34], [104, 1.5], [99, 26], [99, 32], [95, 38], [91, 30], [88, 22], [88, 45]],
    rv: [[102, 34], [100, 28], [100, 34], [97, 40], [95, 24], [95, 32], [92, 44], [103, 30], [103, 38], [62, 20], [62, 48]] },
  freekick: { label: "Tiro libre frontal", ball: [82, 34],
    me: [[5, 34], [40, 20], [40, 48], [60, 34], [80, 34], [91, 20], [92, 30], [92, 38], [91, 48], [70, 14], [70, 54]],
    rv: [[102, 34], [91, 31], [91, 33], [91, 35], [91, 37], [95, 22], [96, 29], [96, 39], [95, 46], [60, 20], [60, 48]] },
  throw: { label: "Saque de banda ofensivo", ball: [86, 0.5],
    me: [[5, 34], [44, 20], [44, 48], [60, 34], [86, -1.2], [80, 8], [90, 10], [84, 20], [92, 22], [97, 30], [88, 34]],
    rv: [[102, 34], [92, 6], [84, 10], [88, 16], [96, 22], [97, 33], [92, 38], [90, 28], [84, 24], [62, 20], [62, 48]] },
  penalty: { label: "Penal", ball: [94, 34],
    me: [[5, 34], [44, 20], [44, 48], [60, 34], [92, 34], [84, 20], [84, 26], [84, 42], [84, 48], [80, 30], [80, 38]],
    rv: [[104.2, 34], [84, 18], [84, 24], [84, 44], [84, 50], [80, 28], [80, 40], [70, 20], [70, 48], [60, 30], [60, 38]] },
};
function applyPreset(B, key, against) {
  const pr = PRESETS[key], f = against ? ([x, y]) => [W - x, H - y] : (a) => a;
  const mine = against ? pr.rv : pr.me, theirs = against ? pr.me : pr.rv;
  B.players.filter((p) => p.team === "me").forEach((p, i) => { [p.x, p.y] = f(mine[i]); });
  B.players.filter((p) => p.team === "rival").forEach((p, i) => { [p.x, p.y] = f(theirs[i]); });
  [B.ball.x, B.ball.y] = f(pr.ball);
  B.items = []; B.frames = [];
}

/* ======================= Componente ======================= */
export async function mountBoard(el, { sb, user, kind }) {
  const isSet = kind === "pelota_parada";
  const S = { B: newState(), tool: "select", sel: null, tmp: null, link: null, voronoi: false, sup: false, undo: [], boards: [], rivals: [], squad: [], frame: -1, playing: false, kind };
  const { data: sq } = await sb.from("gm_players").select("id,name,position,overall,shirt_number").order("name");
  S.squad = sq || [];

  el.innerHTML = `
    <div class="bd">
      <div class="bd-main">
        <div class="toolbar" id="tools"></div>
        <svg id="pitch" viewBox="-4 -4 113 76" xmlns="http://www.w3.org/2000/svg" style="touch-action:none"></svg>
        <div class="toolbar" style="margin-top:.6rem">
          <button class="btn ghost sm" id="undo">↶ Deshacer</button>
          <button class="btn ghost sm" id="clear">Borrar dibujos</button>
          <span class="muted" id="hint"></span>
        </div>
      </div>
      <div class="bd-side">
        <div class="card"><h3>Equipos</h3>
          <label>Mi formación</label><div class="toolbar"><select id="fme">${FORMATIONS.map((f) => `<option>${f}</option>`).join("")}</select>
            <button class="btn sm" id="fill" title="Pone a tus mejores jugadores en cada puesto">Mi mejor once</button></div>
          <label>Formación rival</label><select id="frv">${FORMATIONS.map((f) => `<option>${f}</option>`).join("")}</select>
          <details style="margin-top:.5rem"><summary class="muted" style="cursor:pointer">Subir alineación rival</summary>
            <p class="muted">Pega 11 nombres (uno por línea; opcional con dorsal: "9 John Smith"), del portero al delantero.</p>
            <textarea id="rtext" rows="6"></textarea>
            <button class="btn ghost sm" id="rapply">Aplicar al rival</button>
            <div class="toolbar" style="margin-top:.5rem"><input id="rname" placeholder="Nombre (ej. Gillingham)"><button class="btn ghost sm" id="rsave">Guardar rival</button></div>
            <div class="toolbar"><select id="rlist"></select><button class="btn ghost sm" id="rload">Cargar</button><button class="btn ghost sm" id="rdel">Borrar</button></div>
          </details>
        </div>
        ${isSet ? `<div class="card"><h3>Plantilla de jugada</h3>
          <select id="pre">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
          <div class="toolbar" style="margin-top:.4rem"><button class="btn sm" id="pfor">A favor</button><button class="btn ghost sm" id="pag">En contra</button></div>
          <p class="muted">Coloca a los jugadores en posiciones típicas. Luego muévelos, dibuja y anima.</p></div>` : ""}
        <div class="card"><h3>Análisis</h3>
          <label style="color:inherit"><input type="checkbox" id="cv" style="width:auto"> Diagrama de Voronoi (control del espacio)</label>
          <label style="color:inherit"><input type="checkbox" id="cs" style="width:auto"> Superioridades numéricas</label>
          <div id="ana" class="muted" style="margin-top:.5rem"></div>
        </div>
        <div class="card"><h3>Animación</h3>
          <p class="muted">Coloca a los jugadores, pulsa <b>+ Fotograma</b>, muévelos y repite. Luego reproduce.</p>
          <div class="toolbar"><button class="btn sm" id="fadd">+ Fotograma</button><button class="btn ghost sm" id="fupd">Actualizar</button>
            <button class="btn ghost sm" id="fdel">Quitar</button></div>
          <div id="frames" class="toolbar"></div>
          <div class="toolbar"><button class="btn" id="play">▶ Reproducir</button>
            <select id="spd"><option value="0.6">Lento</option><option value="1" selected>Normal</option><option value="1.8">Rápido</option></select></div>
        </div>
        <div class="card"><h3>${isSet ? "Jugadas guardadas" : "Pizarras guardadas"}</h3>
          <div class="toolbar"><input id="bname" placeholder="Nombre"><button class="btn sm" id="bsave">Guardar</button></div>
          <div class="toolbar"><select id="blist"></select><button class="btn ghost sm" id="bload">Cargar</button><button class="btn ghost sm" id="bdel">Borrar</button></div>
        </div>
      </div>
    </div>`;

  const svg = $("#pitch", el);
  const B = () => S.B;
  const snap = () => JSON.stringify({ players: B().players, ball: B().ball, items: B().items, frames: B().frames, fMe: B().fMe, fRiv: B().fRiv });
  const pushUndo = () => { S.undo.push(snap()); if (S.undo.length > 60) S.undo.shift(); };
  const uid = () => "i" + Math.random().toString(36).slice(2, 8);

  /* ---------- Dibujo ---------- */
  function pitchSvg() {
    const l = 'fill="none" stroke="#fff" stroke-width=".35" opacity=".85"';
    let stripes = "";
    for (let i = 0; i < 10; i++) stripes += `<rect x="${(W / 10) * i}" y="0" width="${W / 10}" height="${H}" fill="${i % 2 ? "#2f8352" : "#2b7a4c"}"/>`;
    return `${stripes}
      <rect x="0" y="0" width="${W}" height="${H}" ${l}/><line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" ${l}/>
      <circle cx="${W / 2}" cy="${H / 2}" r="9.15" ${l}/><circle cx="${W / 2}" cy="${H / 2}" r=".5" fill="#fff"/>
      <rect x="0" y="13.84" width="16.5" height="40.32" ${l}/><rect x="${W - 16.5}" y="13.84" width="16.5" height="40.32" ${l}/>
      <rect x="0" y="24.84" width="5.5" height="18.32" ${l}/><rect x="${W - 5.5}" y="24.84" width="5.5" height="18.32" ${l}/>
      <path d="M16.5 27.6 A9.15 9.15 0 0 1 16.5 40.4" ${l}/><path d="M${W - 16.5} 27.6 A9.15 9.15 0 0 0 ${W - 16.5} 40.4" ${l}/>
      <circle cx="11" cy="${H / 2}" r=".4" fill="#fff"/><circle cx="${W - 11}" cy="${H / 2}" r=".4" fill="#fff"/>
      <rect x="-2" y="30.34" width="2" height="7.32" ${l}/><rect x="${W}" y="30.34" width="2" height="7.32" ${l}/>`;
  }

  const lastName = (n) => String(n || "").trim().split(/\s+/).slice(-1)[0] || "";
  function itemSvg(it) {
    const sel = S.sel === it.id, sw = sel ? 0.9 : 0.55;
    if (it.type === "arrow" || it.type === "run") {
      const c = it.type === "arrow" ? "#f5b041" : "#fff";
      return `<line data-id="${it.id}" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${c}" stroke-width="${sw}" ${it.type === "run" ? 'stroke-dasharray="1.6 1.2"' : ""} marker-end="url(#ah-${it.type})" style="cursor:pointer"/>
        <line data-id="${it.id}" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="transparent" stroke-width="3"/>`;
    }
    if (it.type === "zone") return `<rect data-id="${it.id}" x="${Math.min(it.x1, it.x2)}" y="${Math.min(it.y1, it.y2)}" width="${Math.abs(it.x2 - it.x1)}" height="${Math.abs(it.y2 - it.y1)}" fill="#f5b04133" stroke="#f5b041" stroke-width="${sel ? 0.8 : 0.35}" stroke-dasharray="1 .8"/>`;
    if (it.type === "ellipse") return `<ellipse data-id="${it.id}" cx="${(it.x1 + it.x2) / 2}" cy="${(it.y1 + it.y2) / 2}" rx="${Math.abs(it.x2 - it.x1) / 2}" ry="${Math.abs(it.y2 - it.y1) / 2}" fill="#f5b04133" stroke="#f5b041" stroke-width="${sel ? 0.8 : 0.35}" stroke-dasharray="1 .8"/>`;
    if (it.type === "link") {
      const a = B().players.find((p) => p.id === it.a), b = B().players.find((p) => p.id === it.b);
      if (!a || !b) return "";
      return `<line data-id="${it.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#fff" stroke-width="${sel ? 1 : 0.5}" opacity=".9"/>
        <line data-id="${it.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="3"/>`;
    }
    return "";
  }

  function draw() {
    const ps = B().players;
    let h = `<defs>
      <marker id="ah-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0L6 3L0 6z" fill="#f5b041"/></marker>
      <marker id="ah-run" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0L6 3L0 6z" fill="#fff"/></marker></defs>`;
    h += pitchSvg();
    if (S.voronoi) {
      h += voronoi(ps).map(({ p, poly }) => poly.length ? `<polygon points="${poly.map((q) => q.map((v) => v.toFixed(2)).join(",")).join(" ")}" fill="${COL[p.team]}" fill-opacity=".22" stroke="${COL[p.team]}" stroke-opacity=".7" stroke-width=".2"/>` : "").join("");
    }
    const sup = S.sup ? superiority(ps, B().ball) : null;
    if (sup) {
      h += sup.cells.map((c) => `<rect x="${c.x0}" y="${c.y0}" width="${c.w}" height="${c.h}" fill="${c.d > 0 ? "#2ecc71" : c.d < 0 ? "#ec7063" : "transparent"}" fill-opacity="${Math.min(0.45, Math.abs(c.d) * 0.15)}" stroke="#fff" stroke-opacity=".25" stroke-width=".15" stroke-dasharray="1 1"/>
        <text x="${c.x0 + c.w / 2}" y="${c.y0 + 3.2}" font-size="2.6" fill="#fff" text-anchor="middle" opacity=".9">${c.me} vs ${c.rv}</text>`).join("");
    }
    h += B().items.filter((i) => i.type === "zone" || i.type === "ellipse").map(itemSvg).join("");
    h += B().items.filter((i) => i.type === "link").map(itemSvg).join("");
    h += B().items.filter((i) => i.type === "arrow" || i.type === "run").map(itemSvg).join("");
    if (S.tmp) h += itemSvg({ ...S.tmp, id: "tmp" });
    h += ps.map((p) => `<g data-id="${p.id}" style="cursor:grab">
      <circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${COL[p.team]}" stroke="${S.link === p.id ? "#f5b041" : "#fff"}" stroke-width="${S.link === p.id ? 0.9 : 0.4}"/>
      <text x="${p.x}" y="${p.y + 0.9}" font-size="2.6" font-weight="700" fill="#042" text-anchor="middle" pointer-events="none">${esc(p.num)}</text>
      <text x="${p.x}" y="${p.y + 5}" font-size="2" fill="#fff" text-anchor="middle" stroke="#0008" stroke-width=".35" paint-order="stroke" pointer-events="none">${esc(lastName(p.name))}</text></g>`).join("");
    h += `<g data-id="ball" style="cursor:grab"><circle cx="${B().ball.x}" cy="${B().ball.y}" r="1.2" fill="#fff" stroke="#000" stroke-width=".35"/></g>`;
    svg.innerHTML = h;
    analysis(sup);
    framesUi();
    $("#fme", el).value = B().fMe; $("#frv", el).value = B().fRiv;
    $("#hint", el).textContent = ({
      select: "Arrastra jugadores y balón. Clic en un jugador para editarlo.", arrow: "Arrastra para dibujar una flecha de pase.", run: "Arrastra para dibujar un desmarque.",
      zone: "Arrastra para marcar una zona rectangular.", ellipse: "Arrastra para marcar una zona ovalada.", link: "Clic en dos jugadores para unirlos (otra vez para quitar la unión).", erase: "Clic en un dibujo para borrarlo.",
    })[S.tool];
  }

  function analysis(sup) {
    const box = $("#ana", el);
    let t = "";
    if (S.voronoi) {
      const v = voronoi(B().players);
      const a = (team) => v.filter((x) => x.p.team === team).reduce((s, x) => s + area(x.poly), 0) / (W * H) * 100;
      t += `<div>Control del espacio: <b style="color:${COL.me}">${a("me").toFixed(0)}%</b> yo · <b style="color:${COL.rival}">${a("rival").toFixed(0)}%</b> rival</div>`;
    }
    if (sup) {
      const diffs = sup.cells.filter((c) => c.d !== 0).sort((a, b) => b.d - a.d);
      t += `<div>Alrededor del balón (15 m): <b>${sup.ballMe}</b> vs <b>${sup.ballRv}</b>${sup.ballMe > sup.ballRv ? " · <span class='flag-ok'>superioridad</span>" : sup.ballMe < sup.ballRv ? " · <span class='flag-bad'>inferioridad</span>" : ""}</div>`;
      t += diffs.length ? diffs.map((c) => `<div class="${c.d > 0 ? "flag-ok" : "flag-bad"}">${c.d > 0 ? "▲ Superioridad" : "▼ Inferioridad"} ${c.me}v${c.rv} en ${c.name}</div>`).join("") : "<div>Sin superioridades por zonas.</div>";
    }
    box.innerHTML = t || "Activa Voronoi o superioridades para ver el análisis.";
  }

  function framesUi() {
    $("#frames", el).innerHTML = B().frames.length
      ? B().frames.map((f, i) => `<button class="btn ${S.frame === i ? "" : "ghost"} sm" data-f="${i}">${i + 1}</button>`).join("")
      : `<span class="muted">Sin fotogramas</span>`;
    $$("[data-f]", el).forEach((b) => b.addEventListener("click", () => { if (!S.playing) gotoFrame(Number(b.dataset.f)); }));
  }
  function gotoFrame(i) {
    const f = B().frames[i]; if (!f) return;
    B().players.forEach((p) => { if (f.pos[p.id]) [p.x, p.y] = f.pos[p.id]; });
    [B().ball.x, B().ball.y] = f.ball; S.frame = i; draw();
  }
  const capture = () => ({ pos: Object.fromEntries(B().players.map((p) => [p.id, [p.x, p.y]])), ball: [B().ball.x, B().ball.y] });

  /* ---------- Interacción ---------- */
  const toPt = (e) => {
    const m = svg.getScreenCTM().inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.max(-3, Math.min(W + 3, p.x)), y: Math.max(-3, Math.min(H + 3, p.y)) };
  };
  let drag = null, raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  svg.addEventListener("pointerdown", (e) => {
    if (S.playing) return;
    const p = toPt(e), id = e.target.closest("[data-id]")?.dataset.id, t = S.tool;
    if (t === "select") {
      if (id === "ball") { pushUndo(); drag = { kind: "ball", moved: false }; }
      else if (id && /^[mr]\d+$/.test(id)) { pushUndo(); drag = { kind: "player", id, moved: false, sx: p.x, sy: p.y }; }
      else if (id) { S.sel = id; pushUndo(); drag = { kind: "item", id, last: p, moved: false }; draw(); }
      else { S.sel = null; draw(); }
    } else if (t === "link") {
      if (id && /^[mr]\d+$/.test(id)) {
        if (!S.link) S.link = id;
        else if (S.link !== id) {
          pushUndo();
          const ex = B().items.findIndex((i) => i.type === "link" && ((i.a === S.link && i.b === id) || (i.a === id && i.b === S.link)));
          if (ex >= 0) B().items.splice(ex, 1); else B().items.push({ id: uid(), type: "link", a: S.link, b: id });
          S.link = null;
        } else S.link = null;
        draw();
      }
    } else if (t === "erase") {
      if (id && B().items.some((i) => i.id === id)) { pushUndo(); B().items = B().items.filter((i) => i.id !== id); draw(); }
    } else {
      S.tmp = { type: t, x1: p.x, y1: p.y, x2: p.x, y2: p.y }; drag = { kind: "draw" };
    }
    if (drag) window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  });
  function onMove(e) {
    if (!drag) return;
    const p = toPt(e);
    if (drag.kind === "ball") { B().ball.x = p.x; B().ball.y = p.y; drag.moved = true; }
    else if (drag.kind === "player") {
      const pl = B().players.find((x) => x.id === drag.id);
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 0.6) drag.moved = true;
      if (drag.moved) { pl.x = p.x; pl.y = p.y; }
    } else if (drag.kind === "item") {
      const it = B().items.find((x) => x.id === drag.id), dx = p.x - drag.last.x, dy = p.y - drag.last.y;
      if (it && it.type !== "link") { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
      drag.last = p; drag.moved = true;
    } else if (drag.kind === "draw") { S.tmp.x2 = p.x; S.tmp.y2 = p.y; }
    redraw();
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "draw") {
      const t = S.tmp; S.tmp = null;
      if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 1.5) { pushUndo(); B().items.push({ id: uid(), ...t }); }
    } else if (d.kind === "player" && !d.moved) { S.undo.pop(); editPlayer(d.id); }
    else if (!d.moved) S.undo.pop();
    draw();
  }
  window.addEventListener("keydown", function kd(e) {
    if (!document.body.contains(svg)) return window.removeEventListener("keydown", kd);
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      pushUndo(); B().items = B().items.filter((i) => i.id !== S.sel); S.sel = null; draw();
    }
  });

  function editPlayer(id) {
    const p = B().players.find((x) => x.id === id);
    const mine = p.team === "me";
    const m = openModal(`<h2>${mine ? "Mi jugador" : "Jugador rival"} <button class="btn ghost sm" data-close>Cerrar</button></h2>
      <form id="f"><div class="row">
        ${mine ? `<div><label>Jugador de la plantilla</label><select name="pid"><option value="">(sin asignar)</option>${S.squad.map((s) => `<option value="${s.id}" ${s.id === p.pid ? "selected" : ""}>${esc(s.name)} (${esc(s.position || "–")}${s.overall ? " " + s.overall : ""})</option>`).join("")}</select></div>`
          : `<div><label>Nombre</label><input name="name" value="${esc(p.name)}"></div>`}
        <div><label>Dorsal</label><input name="num" type="number" min="0" max="99" value="${esc(p.num)}"></div>
      </div><div class="actions"><button class="btn">Aceptar</button></div></form>`);
    $("#f", m.el).addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      pushUndo();
      p.num = fd.get("num") || p.num;
      if (mine) {
        const s = S.squad.find((x) => x.id === fd.get("pid"));
        p.pid = s?.id || null; p.name = s?.name || "";
        if (s?.shirt_number && Number(fd.get("num")) === Number(p.num) && !fd.get("num")) p.num = s.shirt_number;
      } else p.name = String(fd.get("name")).trim();
      m.close(); draw();
    });
  }

  /* ---------- Controles ---------- */
  $("#tools", el).innerHTML = TOOLS.map(([k, l]) => `<button class="btn ${k === S.tool ? "" : "ghost"} sm" data-tool="${k}">${l}</button>`).join("");
  $$("[data-tool]", el).forEach((b) => b.addEventListener("click", () => {
    S.tool = b.dataset.tool; S.link = null;
    $$("[data-tool]", el).forEach((x) => x.classList.toggle("ghost", x.dataset.tool !== S.tool));
    draw();
  }));
  $("#undo", el).addEventListener("click", () => {
    const s = S.undo.pop(); if (!s) return;
    Object.assign(S.B, JSON.parse(s)); S.sel = null; draw();
  });
  $("#clear", el).addEventListener("click", () => { pushUndo(); B().items = []; S.sel = null; draw(); });
  $("#fme", el).addEventListener("change", (e) => { pushUndo(); applyFormation(B(), "me", e.target.value); draw(); });
  $("#frv", el).addEventListener("change", (e) => { pushUndo(); applyFormation(B(), "rival", e.target.value); draw(); });
  $("#fill", el).addEventListener("click", () => {
    if (!S.squad.length) return toast("Tu plantilla está vacía.", "err");
    pushUndo(); autoFill(B(), S.squad); draw();
  });
  $("#cv", el).addEventListener("change", (e) => { S.voronoi = e.target.checked; draw(); });
  $("#cs", el).addEventListener("change", (e) => { S.sup = e.target.checked; draw(); });

  $("#rapply", el).addEventListener("click", () => {
    const lines = $("#rtext", el).value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 11);
    if (!lines.length) return toast("Pega los nombres primero.", "err");
    pushUndo();
    const rv = B().players.filter((p) => p.team === "rival");
    lines.forEach((l, i) => {
      const m = l.match(/^(\d{1,2})[\s.,;)\-\t]+(.+)$/);
      rv[i].num = m ? Number(m[1]) : i + 1; rv[i].name = m ? m[2].trim() : l;
    });
    draw(); toast(`${lines.length} jugadores rivales cargados`);
  });

  if (isSet) {
    const doPreset = (against) => { pushUndo(); applyPreset(B(), $("#pre", el).value, against); S.frame = -1; draw(); };
    $("#pfor", el).addEventListener("click", () => doPreset(false));
    $("#pag", el).addEventListener("click", () => doPreset(true));
  }

  $("#fadd", el).addEventListener("click", () => { pushUndo(); B().frames.push(capture()); S.frame = B().frames.length - 1; draw(); });
  $("#fupd", el).addEventListener("click", () => { if (S.frame < 0) return toast("Elige un fotograma.", "err"); pushUndo(); B().frames[S.frame] = capture(); toast("Fotograma actualizado"); });
  $("#fdel", el).addEventListener("click", () => {
    if (S.frame < 0) return toast("Elige un fotograma.", "err");
    pushUndo(); B().frames.splice(S.frame, 1); S.frame = Math.min(S.frame, B().frames.length - 1); draw();
  });
  $("#play", el).addEventListener("click", () => {
    if (S.playing) { S.playing = false; return; }
    const fr = B().frames;
    if (fr.length < 2) return toast("Necesitas al menos 2 fotogramas.", "err");
    S.playing = true; $("#play", el).textContent = "■ Detener";
    const speed = Number($("#spd", el).value), segMs = 1400 / speed, total = segMs * (fr.length - 1), t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now) => {
      if (!S.playing) return end();
      const el_ = Math.min(now - t0, total), seg = Math.min(fr.length - 2, Math.floor(el_ / segMs)), k = ease((el_ - seg * segMs) / segMs);
      const a = fr[seg], b = fr[seg + 1];
      B().players.forEach((p) => {
        const pa = a.pos[p.id] || [p.x, p.y], pb = b.pos[p.id] || pa;
        p.x = pa[0] + (pb[0] - pa[0]) * k; p.y = pa[1] + (pb[1] - pa[1]) * k;
      });
      B().ball.x = a.ball[0] + (b.ball[0] - a.ball[0]) * k; B().ball.y = a.ball[1] + (b.ball[1] - a.ball[1]) * k;
      S.frame = seg; draw();
      if (el_ >= total) end(); else requestAnimationFrame(step);
    };
    const end = () => { S.playing = false; $("#play", el).textContent = "▶ Reproducir"; draw(); };
    gotoFrame(0); requestAnimationFrame(step);
  });

  /* ---------- Guardar / cargar ---------- */
  async function refreshLists() {
    const { data, error } = await sb.from("gm_boards").select("*");
    if (error) { S.noSql = true; return; }
    S.boards = (data || []).filter((b) => b.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    S.rivals = (data || []).filter((b) => b.kind === "rival").sort((a, b) => a.name.localeCompare(b.name));
    const opts = (l) => l.length ? l.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("") : `<option value="">(ninguna)</option>`;
    $("#blist", el).innerHTML = opts(S.boards); $("#rlist", el).innerHTML = opts(S.rivals);
  }
  const needSql = () => S.noSql && toast("Falta ejecutar supabase/schema_pizarra.sql en Supabase.", "err");
  async function save(name, k, data, list) {
    if (!name) { toast("Escribe un nombre.", "err"); return false; }
    const ex = list.find((b) => b.name.toLowerCase() === name.toLowerCase());
    const q = ex ? sb.from("gm_boards").update({ data, updated_at: new Date().toISOString() }).eq("id", ex.id)
      : sb.from("gm_boards").insert({ user_id: user.id, name, kind: k, data });
    const { error } = await q;
    if (error) { toast(error.message, "err"); return false; }
    await refreshLists(); toast("Guardado"); return true;
  }
  $("#bsave", el).addEventListener("click", () => { if (needSql()) return; save($("#bname", el).value.trim(), kind, JSON.parse(snap()), S.boards); });
  $("#bload", el).addEventListener("click", () => {
    const b = S.boards.find((x) => x.id === $("#blist", el).value); if (!b) return;
    pushUndo(); Object.assign(S.B, b.data); S.sel = null; S.frame = -1; $("#bname", el).value = b.name; draw();
  });
  $("#bdel", el).addEventListener("click", async () => {
    const id = $("#blist", el).value; if (!id || !confirm("¿Borrar esta pizarra?")) return;
    const { error } = await sb.from("gm_boards").delete().eq("id", id); if (error) return toast(error.message, "err");
    refreshLists();
  });
  $("#rsave", el).addEventListener("click", () => {
    if (needSql()) return;
    save($("#rname", el).value.trim(), "rival", { fRiv: B().fRiv, players: B().players.filter((p) => p.team === "rival") }, S.rivals);
  });
  $("#rload", el).addEventListener("click", () => {
    const b = S.rivals.find((x) => x.id === $("#rlist", el).value); if (!b) return;
    pushUndo(); applyFormation(B(), "rival", b.data.fRiv || B().fRiv);
    const rv = B().players.filter((p) => p.team === "rival");
    (b.data.players || []).forEach((p, i) => { if (rv[i]) { rv[i].name = p.name; rv[i].num = p.num; } });
    $("#rname", el).value = b.name; draw();
  });
  $("#rdel", el).addEventListener("click", async () => {
    const id = $("#rlist", el).value; if (!id || !confirm("¿Borrar este rival?")) return;
    const { error } = await sb.from("gm_boards").delete().eq("id", id); if (error) return toast(error.message, "err");
    refreshLists();
  });

  draw();
  refreshLists();
}
