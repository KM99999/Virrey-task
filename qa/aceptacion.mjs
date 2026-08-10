// Prueba de ACEPTACIÓN EN VIVO de los 4 temas núcleo (ver GUIA_ACEPTACION.md).
// Ejecuta las 4 × 6 = 24 consultas de la guía contra el sistema desplegado y comprueba, de forma
// INDEPENDIENTE (sin reusar el motor del sistema), que cada respuesta:
//   (1) es determinista (fuente=local, no IA);
//   (2) es matemáticamente CORRECTA para el ejercicio planteado;
//   (3) la PIZARRA coincide con la VOZ (ninguna expresión con dos valores distintos);
//   (4) la práctica NO es idéntica al ejemplo ya resuelto (no revela la respuesta).
// Uso:  node qa/aceptacion.mjs        (usa https://math-ia.onrender.com)
//       MATHIA_URL=http://localhost:3000 node qa/aceptacion.mjs
import { flattenLSG } from "../public/pseLight.js";

const BASE = process.env.MATHIA_URL || "https://math-ia.onrender.com";

// ---------- utilidades matemáticas INDEPENDIENTES (no usan src/) ----------
const sup = (s) => String(s).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => "^" + "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c));
const canon = (s) => sup(String(s).toLowerCase()).replace(/\s+/g, "").replace(/·|×/g, "*").replace(/÷/g, "/");
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
function evalArith(e) { const t = canon(e).replace(/,/g, "."); if (!/^[-+*/().\d]+$/.test(t)) return null; try { const v = Function('"use strict";return(' + t + ")")(); return Number.isFinite(v) ? v : null; } catch { return null; } }
// Evalúa un lado de la ecuación sustituyendo x, ADMITIENDO PARÉNTESIS y multiplicación implícita
// ("2(x + 4)", "3(x - 2) + 4"). Antes solo se aceptaban términos sueltos "±ax / ±b", así que las
// ecuaciones del nivel DIFÍCIL —que son difíciles precisamente por el paréntesis— no se podían
// evaluar; y como no distinguía "no sé leerlo" de "está mal", las marcaba como RESPUESTA INCORRECTA.
// El verificador daba por defectuoso un ejercicio correcto (2(x + 4) = 3x - 1 ⇒ x = 9, bien resuelto).
function evalLinSide(side, x) {
  let s = canon(side).replace(/,/g, ".").replace(/[−–—]/g, "-");
  if (!s) return null;
  s = s.replace(/(\d)([a-z(])/g, "$1*$2").replace(/([a-z)])(\()/g, "$1*$2").replace(/(\))(\d|[a-z])/g, "$1*$2");
  s = s.replace(/[a-z]/g, `(${x})`);
  if (!/^[-+*/().\d\s]+$/.test(s)) return null;
  try { const v = Function('"use strict";return(' + s + ")")(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
function solveLin(eq) { const m = eq.match(/^(.+)=(.+)$/); if (!m) return null; const L0 = evalLinSide(m[1], 0), L1 = evalLinSide(m[1], 1), R0 = evalLinSide(m[2], 0), R1 = evalLinSide(m[2], 1); if ([L0, L1, R0, R1].some((v) => v === null)) return null; const a = (L1 - L0) - (R1 - R0), b = R0 - L0; return a === 0 ? null : b / a; }
// La respuesta puede venir como fracción exacta ("7/2"): se compara por VALOR, no por texto.
const numResp = (s) => { const t = String(s).trim().replace(",", "."); const f = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/); if (f) return +f[1] / +f[2]; const n = parseFloat(t); return Number.isFinite(n) ? n : NaN; };
function parsePoly(t) { t = sup(t).replace(/\s+/g, ""); if (!/^[+-]/.test(t)) t = "+" + t; const terms = t.match(/[+-](?:\d*x(?:\^\d+)?|\d+)/g); if (!terms || terms.join("").length !== t.length) return null; const map = new Map(); for (const term of terms) { const g = term[0] === "-" ? -1 : 1; const b = term.slice(1); if (b.includes("x")) { const mm = b.match(/^(\d*)x(?:\^(\d+))?$/); if (!mm) return null; const c = mm[1] === "" ? 1 : Number(mm[1]); const e = mm[2] ? Number(mm[2]) : 1; map.set(e, (map.get(e) || 0) + g * c); } else map.set(0, (map.get(0) || 0) + g * Number(b)); } return map; }
function polyStr(m) { const es = [...m.entries()].filter(([, c]) => c !== 0).sort((a, b) => b[0] - a[0]); if (!es.length) return "0"; return es.map(([e, c], i) => { const a = Math.abs(c); const cs = a === 1 && e !== 0 ? "" : String(a); const mono = e === 0 ? String(a) : e === 1 ? cs + "x" : cs + "x^" + e; return (i === 0 ? (c < 0 ? "-" : "") : (c < 0 ? "-" : "+")) + mono; }).join(""); }
function derive(f) { const p = parsePoly(f); if (!p) return null; const d = new Map(); for (const [e, c] of p) if (e > 0) d.set(e - 1, (d.get(e - 1) || 0) + c * e); return polyStr(d); }
// Desarrolla "(ax - b)(cx + d)" y también "k(ax - b)(cx + d)" — el factor común FUERA de los
// paréntesis, que es la forma correcta de "3x² - 27 = 3(x - 3)(x + 3)". Sin admitirlo, el verificador
// no sabía comprobar la factorización del nivel difícil y la daba por "no verificable" aunque fuera
// correcta. Se comprueba multiplicando de vuelta: matemática distinta de la que produjo el resultado.
function expandFactor(r) { const mm = canon(r).match(/^(\d*)\((\d*)x-(\d+)\)\((\d*)x\+(\d+)\)$/); if (!mm) return null; const k = mm[1] === "" ? 1 : +mm[1], a = mm[2] === "" ? 1 : +mm[2], b = +mm[3], c = mm[4] === "" ? 1 : +mm[4], d = +mm[5]; const m = new Map(); m.set(2, k * a * c); m.set(1, k * (a * d - c * b)); m.set(0, -k * b * d); return polyStr(m); }
function sumFrac(a, b, c, d) { const n = a * d + c * b, den = b * d, g = gcd(n, den); return den / g === 1 ? String(n / g) : (n / g) + "/" + (den / g); }

// ---------- coherencia pizarra ↔ voz ----------
const esLimpia = (s) => s && !/[a-z]{2,}/i.test(s) && !/(^|\s)[yoeu](\s|$)/i.test(s) && !/[a-z]\s+[a-z]/i.test(s) && /[0-9a-z]/i.test(s);
function igualdades(texto) { const out = []; const cand = texto.match(/[0-9A-Za-z().²³⁴⁵⁶⁷⁸⁹^/*·×÷+\- ]*=[0-9A-Za-z().²³⁴⁵⁶⁷⁸⁹^/*·×÷+\-= ]*/g) || []; for (const c of cand) { const segs = c.split("=").map((s) => s.trim()).filter(Boolean); if (segs.length < 2 || !segs.every(esLimpia)) continue; for (let i = 0; i < segs.length - 1; i++) out.push([segs[i], segs[i + 1]]); if (segs.length >= 3) out.push([segs[0], segs[segs.length - 1]]); } return out; }
const mismoValor = (a, b) => { const na = evalArith(a), nb = evalArith(b); return (na !== null && nb !== null) ? Math.abs(na - nb) < 1e-9 : canon(a) === canon(b); };

// ---------- réplica mínima de la clasificación del frontend (public/app.js) ----------
const norm = (q) => q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const esSaludo = (q) => /^(hola|gracias|ok)\b/.test(norm(q));
const tieneTema = (q) => /(derivad|ecuacion|fraccion|factoriz|lineal|primer grado)/.test(norm(q)) || /[a-z][²³⁴⁵⁶⁷⁸⁹]|\d\s*[-+*/=]/.test(q);
function clasificar(q) { const n = norm(q);
  if (/mas\s.*(dificil|avanzad|complej)/.test(n) || (n.split(/\s+/).length <= 5 && /(dificil|avanzad)/.test(n))) return "mas_dificil";
  if (/mas\s.*(facil|simple|sencill)/.test(n) || (n.split(/\s+/).length <= 5 && /(facil|simple|sencill)/.test(n))) return "mas_facil";
  if (/\bno\s+(lo\s+)?(entend|entiend)/.test(n) || /explica\w*\s+(lo\s+)?mejor/.test(n)) return "reexplicar";
  if (/otro ejemplo|dame.*ejemplo|de la vida|vida real|vida cotidiana/.test(n)) return "continuacion";
  return null; }

async function ask(query, S) {
  const body = { query }; const seg = S.lastTopic ? clasificar(query) : null;
  if (S.lastTopic) body.currentTopic = S.lastTopic; if (S.prev) body.previo = S.prev;
  if (seg) { body.contexto = S.lastTopic; body.seguimiento = seg; }
  if (!seg && !esSaludo(query) && (tieneTema(query) || !S.lastTopic)) S.lastTopic = query;
  const r = await fetch(BASE + "/api/query", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  const j = await r.json(); const flat = flattenLSG(j.lsg || {});
  S.prev = flat.filter((d) => d.tipo === "hablar").slice(0, 3).map((d) => d.texto).join(" ").slice(0, 300);
  return { fuente: j.fuente_ia, modelo: j.modelo, flat, boards: flat.filter((d) => d.tipo === "pizarra").map((d) => d.contenido), preg: flat.find((d) => d.tipo === "preguntar") };
}

function verificar(tema, r) {
  const p = [];
  if (r.fuente !== "local") p.push(`no determinista (fuente=${r.fuente})`);
  const q = r.preg; if (!q) { p.push("sin práctica"); return p; }
  const resp = String(q.respuesta || "").trim(); const qt = q.texto || "";
  const board = r.boards.length ? r.boards[r.boards.length - 1] : "";
  // (2) respuesta correcta, independiente
  let correcta = null, ej = "";
  if (tema === "lineal") { const m = qt.match(/vale x en (.+?)\?/) || (board.includes("=") ? [null, board.replace(/\.$/, "")] : null); if (m) { ej = m[1]; const x = solveLin(canon(m[1])); correcta = x === null ? null : Math.abs(x - numResp(resp)) < 1e-9; } }
  // La lección APLICADA (vida real) pregunta "Si la derivada es 2t, ¿cuánto vale a los 5 segundos?" —
  // y el punto se nombra distinto en cada escenario ("al día 4", "al minuto 5", "cuando has avanzado 4
  // metros", "al producir el artículo 5"). Sin esta rama el verificador no sabía comprobarla y la daba
  // por "no verificable": 2 de 24 salían ✗ con la lección CORRECTA (2 × 5 = 10), así que la evidencia de
  // aceptación contradecía al producto. Se evalúa igual que en clase: sustituir el valor en 2·var.
  // La lección APLICADA (vida real) plantea una SUSTITUCIÓN: "la derivada es 2t, sustituye t por 5".
  // Se comprueba haciendo la sustitución aquí (coeficiente × valor), no reusando el motor del sistema.
  // El enunciado cambió al aclarar que NO hay que volver a derivar —el alumno lo leía como que le
  // pedían derivar y a la vez le daban un número—, así que se aceptan las dos redacciones.
  else if (tema === "derivada") {
    const m = qt.match(/derivada de (.+?)\?/);
    const sus = qt.match(/derivada:?\s*(?:es\s*)?(\d*)\s*([a-z])\b[\s\S]*?sustituye\s+\2\s+por\s+(\d+)/i)
      || qt.match(/si la derivada es (\d*)([a-z])[^0-9]*(\d+)/i);
    if (m) { ej = m[1]; const d = derive(m[1]); correcta = d !== null && canon(d) === canon(resp); }
    else if (sus) { const k = sus[1] === "" ? 1 : +sus[1]; ej = `${k}${sus[2]} con ${sus[2]} = ${sus[3]}`; correcta = Math.abs(k * (+sus[3]) - numResp(resp)) < 1e-9; }
    else if (/velocidad/.test(qt)) { const mv = qt.match(/v\(t\)\s*=\s*(\d+)t.*?(\d+)\s*segundos/); if (mv) { ej = qt; correcta = String(+mv[1] * +mv[2]) === resp; } }
  }
  else if (tema === "factorizacion") { const m = qt.match(/factoriza (.+?)\?/); if (m) { ej = m[1]; const exp = expandFactor(resp), tg = parsePoly(m[1]); correcta = exp && tg && canon(exp) === canon(polyStr(tg)); } }
  else if (tema === "fraccion") { const m = qt.match(/(\d+)\/(\d+)\s*\+\s*(\d+)\/(\d+)/); if (m) { ej = `${m[1]}/${m[2]}+${m[3]}/${m[4]}`; correcta = canon(sumFrac(+m[1], +m[2], +m[3], +m[4])) === canon(resp); } }
  if (correcta === false) p.push(`RESPUESTA INCORRECTA: "${ej}" ⇒ ${resp}`);
  if (correcta === null) p.push(`respuesta no verificable ("${qt.slice(0, 40)}")`);
  // (3) pizarra ↔ voz
  const mapa = new Map();
  for (const d of r.flat) { const src = d.tipo === "pizarra" ? "pizarra" : d.tipo === "hablar" ? "voz" : null; if (!src) continue; for (const [L, R] of igualdades(d.contenido || d.texto || "")) { const k = canon(L); if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push({ R, src }); } }
  for (const [L, arr] of mapa) for (let i = 1; i < arr.length; i++) if (!mismoValor(arr[0].R, arr[i].R)) { p.push(`PIZARRA≠VOZ: ${L}=${arr[0].R} vs ${arr[i].R}`); break; }
  // (4) práctica ≠ ejemplo resuelto
  if (ej && canon(r.boards[0] || "") === canon(ej)) p.push(`práctica IGUAL al ejemplo (${ej})`);
  return p;
}

const GUIONES = {
  lineal: ["Explícame las ecuaciones lineales", "Explícalo con ejemplos de la vida cotidiana", "Proponme un problema más difícil", "Ahora uno más fácil", "Dame otro ejemplo", "No entendí, explícalo mejor"],
  derivada: ["Enséñame las derivadas", "Dame un ejemplo de la vida real", "Proponme un problema más difícil", "Ahora uno más fácil", "Dame otro ejemplo", "No entendí, explícalo mejor"],
  factorizacion: ["Explícame la factorización", "Explícalo con ejemplos de la vida cotidiana", "Proponme un problema más difícil", "Ahora uno más fácil", "Dame otro ejemplo", "No entendí, explícalo mejor"],
  fraccion: ["Enséñame las fracciones", "Dame un ejemplo de la vida real", "Proponme un problema más difícil", "Ahora uno más fácil", "Dame otro ejemplo", "No entendí, explícalo mejor"],
};

console.log(`Prueba de aceptación en vivo contra ${BASE}\n`);
let total = 0, ok = 0; const fallos = [];
for (const [tema, guion] of Object.entries(GUIONES)) {
  const S = { lastTopic: null, prev: "" };
  for (const q of guion) {
    const r = await ask(q, S); total++;
    const probs = verificar(tema, r);
    if (probs.length === 0) { ok++; console.log(`  ✓ [${tema}] "${q}"`); }
    else { fallos.push(`[${tema}] "${q}": ${probs.join(" | ")}`); console.log(`  ✗ [${tema}] "${q}" → ${probs.join(" | ")}`); }
  }
}
console.log(`\n${ok === total ? "✅" : "❌"} ACEPTACIÓN: ${ok}/${total} correctas (deterministas, matemática correcta, pizarra=voz, práctica distinta).`);
process.exit(ok === total ? 0 : 1);
