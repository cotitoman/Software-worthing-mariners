import { $, $$, esc, normPos, isPos, toNum, toast } from "./util.js";

/* Nombres de columna aceptados (español / inglés / FC) → campo interno */
const ALIASES = {
  name: ["name", "nombre", "player", "jugador", "player name"],
  position: ["position", "pos", "posicion", "posición"],
  nationality: ["nationality", "nacionalidad", "nation", "pais", "país"],
  age: ["age", "edad"],
  shirt_number: ["number", "shirt_number", "dorsal", "kit number", "no", "#"],
  overall: ["overall", "ovr", "ova", "media", "valoracion", "valoración"],
  potential: ["potential", "pot", "potencial"],
  contract_until: ["contract_until", "contract", "contrato", "contract end", "contract expiry"],
  wage_eur: ["wage", "wage_eur", "sueldo", "salario", "salary"],
  value_eur: ["value", "value_eur", "valor", "market value"],
  pace: ["pace", "pac", "ritmo", "rit"],
  shooting: ["shooting", "sho", "tiro", "tir"],
  passing: ["passing", "pas", "pase"],
  dribbling: ["dribbling", "dri", "regate", "reg"],
  defending: ["defending", "def", "defensa"],
  physical: ["physical", "phy", "fisico", "físico", "fis"],
  base_apps: ["apps", "games", "matches", "pj", "partidos", "appearances", "played"],
  base_minutes: ["minutes", "min", "minutos"],
  base_goals: ["goals", "goles", "g"],
  base_assists: ["assists", "asistencias", "a", "ast"],
  base_clean_sheets: ["clean_sheets", "clean sheets", "cs", "porterias imbatidas", "porterías imbatidas", "imbatidas"],
};
const STATS = ["base_apps", "base_minutes", "base_goals", "base_assists", "base_clean_sheets"];
const TEXT = new Set(["name", "position", "nationality"]);

const FIELD_LABELS = {
  "": "Ignorar", overall: "OVR", potential: "Potencial", age: "Edad", shirt_number: "Dorsal",
  base_apps: "PJ", base_minutes: "Minutos", base_goals: "Goles", base_assists: "Asistencias",
  base_clean_sheets: "P. imbatidas", value_eur: "Valor", wage_eur: "Sueldo",
};
const PRESETS = {
  plantilla: ["overall", "age"],
  stats: ["base_apps", "base_goals", "base_assists", "base_clean_sheets"],
  manual: [],
};

const lookup = {};
for (const [field, names] of Object.entries(ALIASES)) for (const n of names) lookup[n] = field;
const clean = (s) => String(s).trim().toLowerCase();

/* Convierte una fila cualquiera (CSV/JSON) en un jugador con nuestros campos */
function normalizeRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = lookup[clean(k)];
    if (!field || v === "" || v === null || v === undefined) continue;
    if (TEXT.has(field)) out[field] = String(v).trim();
    else { const n = toNum(v); if (n !== null) out[field] = n; }
  }
  if (out.position) out.position = normPos(out.position);
  if (!out.name) return null;
  return out;
}

/* ---------------- Guardado compartido ---------------- */
async function commit(ctx, rows, { update, stats }) {
  const existing = new Map(ctx.getPlayers().map((p) => [clean(p.name), p]));
  const toInsert = [], toUpdate = [];
  for (const r of rows) {
    const row = { ...r };
    if (!stats) STATS.forEach((k) => delete row[k]);
    const ex = existing.get(clean(row.name));
    if (ex) { if (update) toUpdate.push({ id: ex.id, patch: row }); }
    else {
      toInsert.push({
        position: null, nationality: null, age: null, shirt_number: null, overall: null, potential: null,
        contract_until: null, wage_eur: null, value_eur: null,
        pace: null, shooting: null, passing: null, dribbling: null, defending: null, physical: null,
        base_apps: 0, base_minutes: 0, base_goals: 0, base_assists: 0, base_clean_sheets: 0,
        ...row,
      });
    }
  }
  let errors = 0;
  if (toInsert.length) {
    const { error } = await ctx.sb.from("gm_players").insert(toInsert);
    if (error) { errors++; toast(error.message, "err"); }
  }
  const results = await Promise.all(toUpdate.map(({ id, patch }) => {
    const { name, ...rest } = patch; // el nombre es la clave, no se cambia
    return Object.keys(rest).length ? ctx.sb.from("gm_players").update(rest).eq("id", id) : { error: null };
  }));
  results.forEach((r) => { if (r.error) { errors++; toast(r.error.message, "err"); } });
  if (!errors) toast(`Importado: ${toInsert.length} nuevos, ${toUpdate.length} actualizados`);
  ctx.reload();
}

/* ---------------- Pantalla ---------------- */
export function mountImport(pane, ctx) {
  pane.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h3>1 · Archivo CSV o JSON</h3>
        <p class="muted">Columnas reconocidas (español o inglés): nombre, posición, edad, OVR, potencial, dorsal, contrato, sueldo, valor,
        atributos (RIT/TIR/PAS/REG/DEF/FIS) y estadísticas (PJ, minutos, goles, asistencias, imbatidas). Los jugadores se identifican por nombre.</p>
        <div class="drop"><input type="file" id="file" accept=".csv,.json,text/csv,application/json"></div>
        <pre class="hint">nombre,posicion,edad,ovr,pj,goles,asistencias
J. Smith,ST,24,68,12,7,2</pre>
      </div>
      <div class="card">
        <h3>2 · Capturas de pantalla (OCR)</h3>
        <p class="muted">Sube capturas de tu plantilla o de las estadísticas del modo carrera. Se leen con OCR y las revisas antes de guardar.
        Funciona mejor con capturas nítidas, sin zoom y con letra clara.</p>
        <div class="drop"><input type="file" id="img" accept="image/*" multiple></div>
        <div class="progress" id="pg" hidden><i></i></div><div id="pgt" class="muted"></div>
      </div>
    </div>
    <div id="review"></div>`;

  $("#file", pane).addEventListener("change", (e) => e.target.files[0] && fromFile(e.target.files[0], pane, ctx));
  $("#img", pane).addEventListener("change", (e) => e.target.files.length && fromImages([...e.target.files], pane, ctx));
}

/* ---------------- Método 1: CSV / JSON ---------------- */
async function fromFile(file, pane, ctx) {
  const text = await file.text();
  let raw = [];
  try {
    if (/\.json$/i.test(file.name)) {
      const j = JSON.parse(text);
      raw = Array.isArray(j) ? j : j.players || j.squad || [];
    } else {
      const res = Papa.parse(text, { header: true, skipEmptyLines: true, delimitersToGuess: [",", ";", "\t"] });
      raw = res.data;
    }
  } catch (e) { return toast("No se pudo leer el archivo: " + e.message, "err"); }
  const rows = raw.map(normalizeRow).filter(Boolean);
  if (!rows.length) return toast("No encontré jugadores. Revisa que exista una columna de nombre.", "err");

  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const rv = $("#review", pane);
  rv.innerHTML = `<div class="card">
    <h3>Vista previa: ${rows.length} jugadores</h3>
    <div class="tw" style="max-height:320px"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows.slice(0, 40).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${options(true)}
    <div class="actions"><button class="btn" id="go">Importar ${rows.length} jugadores</button></div></div>`;
  $("#go", rv).addEventListener("click", async (e) => {
    e.target.disabled = true;
    await commit(ctx, rows, readOptions(rv));
    rv.innerHTML = "";
  });
}

function options(withStats) {
  return `<div class="row" style="margin-top:.6rem">
    <label style="color:inherit"><input type="checkbox" id="o-up" checked style="width:auto"> Actualizar jugadores que ya existen (por nombre)</label>
    ${withStats ? `<label style="color:inherit"><input type="checkbox" id="o-st" checked style="width:auto"> Guardar estadísticas como acumulado previo</label>` : ""}
  </div>
  <p class="muted">Si ya registras partidos en la app, importa las estadísticas solo una vez (estado inicial) para no duplicarlas.</p>`;
}
const readOptions = (rv) => ({ update: $("#o-up", rv).checked, stats: $("#o-st", rv) ? $("#o-st", rv).checked : true });

/* ---------------- Método 2: OCR ---------------- */
async function fromImages(files, pane, ctx) {
  if (typeof Tesseract === "undefined") return toast("No se pudo cargar el motor OCR (revisa tu conexión).", "err");
  const pg = $("#pg", pane), bar = $("#pg i", pane), txt = $("#pgt", pane);
  pg.hidden = false;
  const lines = [];
  for (let i = 0; i < files.length; i++) {
    txt.textContent = `Leyendo imagen ${i + 1} de ${files.length}…`;
    try {
      const { data } = await Tesseract.recognize(files[i], "eng", {
        logger: (m) => { if (m.status === "recognizing text") bar.style.width = ((i + m.progress) / files.length) * 100 + "%"; },
      });
      lines.push(...data.text.split("\n"));
    } catch (e) { toast("Error leyendo " + files[i].name + ": " + e.message, "err"); }
  }
  bar.style.width = "100%";
  txt.textContent = "Lectura terminada. Revisa los datos antes de guardar.";
  const parsed = lines.map(parseLine).filter(Boolean);
  if (!parsed.length) return toast("No pude reconocer filas de jugadores en las capturas.", "err");
  reviewOCR(parsed, pane, ctx);
}

function parseLine(raw) {
  const line = raw.replace(/[|_\[\]{}©®]/g, " ").replace(/\s+/g, " ").trim();
  if (line.length < 4) return null;
  const tokens = line.split(" ");
  let position = null;
  if (isPos(tokens[0]) && tokens.length > 2) position = normPos(tokens.shift());
  const name = [];
  let i = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[\d.,+\-%€KMkm]+$/.test(t) && /\d/.test(t)) break;
    if (isPos(t) && name.length) break;
    name.push(t);
  }
  const rest = tokens.slice(i);
  if (!position) { const pt = rest.find(isPos); if (pt) position = normPos(pt); }
  const nums = rest.filter((t) => !isPos(t) && /\d/.test(t)).map((t) => toNum(t)).filter((n) => n !== null).slice(0, 8);
  const nm = name.join(" ").replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ.'’\- ]+$/g, "").trim();
  if (nm.length < 3 || !/[A-Za-zÀ-ÿ]{2}/.test(nm)) return null;
  if (!nums.length && !position) return null;
  return { name: nm, position, nums };
}

function reviewOCR(parsed, pane, ctx) {
  const nCols = Math.max(...parsed.map((r) => r.nums.length), 1);
  const rv = $("#review", pane);
  const selHtml = (i) => `<select data-col="${i}">${Object.entries(FIELD_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>`;

  rv.innerHTML = `<div class="card">
    <h3>Revisar lectura OCR (${parsed.length} filas)</h3>
    <div class="row">
      <div><label>Tipo de captura</label><select id="preset">
        <option value="plantilla">Plantilla (OVR, edad)</option>
        <option value="stats">Estadísticas (PJ, goles, asist., imbatidas)</option>
        <option value="manual">Elegir columnas a mano</option></select></div>
    </div>
    <p class="muted">Elige a qué campo corresponde cada columna numérica. Corrige lo que el OCR haya leído mal y desmarca las filas que no sirvan.</p>
    <div class="tw" style="max-height:420px"><table><thead><tr><th></th><th>Nombre</th><th>Pos</th>
      ${Array.from({ length: nCols }, (_, i) => `<th>${selHtml(i)}</th>`).join("")}</tr></thead>
    <tbody>${parsed.map((r, ri) => `<tr data-r="${ri}"><td><input type="checkbox" class="use" checked></td>
      <td><input class="nm" value="${esc(r.name)}" style="min-width:160px"></td>
      <td><input class="ps" value="${esc(r.position || "")}" style="width:64px"></td>
      ${Array.from({ length: nCols }, (_, i) => `<td><input class="nv" data-i="${i}" value="${r.nums[i] ?? ""}" style="width:80px"></td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    ${options(true)}
    <div class="actions"><button class="btn" id="go">Guardar jugadores seleccionados</button></div></div>`;

  const applyPreset = () => {
    const map = PRESETS[$("#preset", rv).value];
    $$("[data-col]", rv).forEach((s, i) => { s.value = map[i] || ""; });
  };
  $("#preset", rv).addEventListener("change", applyPreset);
  applyPreset();

  $("#go", rv).addEventListener("click", async (e) => {
    const colField = $$("[data-col]", rv).map((s) => s.value);
    const used = colField.filter(Boolean);
    if (new Set(used).size !== used.length) return toast("Hay dos columnas con el mismo campo.", "err");
    const rows = [];
    $$("tbody tr", rv).forEach((tr) => {
      if (!$(".use", tr).checked) return;
      const name = $(".nm", tr).value.trim();
      if (!name) return;
      const row = { name };
      const pos = normPos($(".ps", tr).value);
      if (pos) row.position = pos;
      $$(".nv", tr).forEach((inp) => {
        const f = colField[Number(inp.dataset.i)];
        const n = toNum(inp.value);
        if (f && n !== null) row[f] = n;
      });
      rows.push(row);
    });
    if (!rows.length) return toast("No hay filas seleccionadas.", "err");
    e.target.disabled = true;
    await commit(ctx, rows, readOptions(rv));
    rv.innerHTML = "";
  });
}
