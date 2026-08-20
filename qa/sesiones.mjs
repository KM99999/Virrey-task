// PRUEBA POR SESIONES — se prueba el sistema COMO LO USA EL ALUMNO: conversando.
//
// Por qué existe: `qa/aceptacion.mjs` prueba consultas SUELTAS (una, se comprueba, se reinicia) y
// llegó a dar 24/24 sobre una versión en la que el cliente SÍ encontraba fallos. Todos aquellos
// fallos vivían en la SECUENCIA, no en la consulta aislada: "dame otro ejemplo" solo se desvía
// cuando ya hay un tema activo, y el bucle de escenarios solo aparece en la 4.ª o 5.ª petición.
// Aquí se reproducen CONVERSACIONES completas, con el mismo estado que mantiene el navegador.
//
//   node qa/sesiones.mjs                              (contra producción)
//   MATHIA_URL=http://localhost:3000 node qa/sesiones.mjs
//
// La comprobación matemática es INDEPENDIENTE: no usa las funciones del producto.
import { readFileSync } from "node:fs";

const BASE = process.env.MATHIA_URL || "https://math-ia.onrender.com";

// ── Se cargan las funciones REALES del frontend (public/app.js) para decidir el `seguimiento`
//    exactamente como lo haría el navegador. Si se copiaran a mano, se probaría la copia.
const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function cargarFrontend(conEjercicio) {
  let src = conEjercicio ? "let lastExercise = { ejercicio: '2x + 5 = 15', respuesta: '5' };\n" : "let lastExercise = null;\n";
  for (const n of ["esSaludoOMeta", "esSeguimiento", "ajusteNivel", "esContinuacion", "pidePasos",
    "pideOtroEjercicio", "pideResolverOtro", "pideResolverActual", "nombraOtroTema", "tieneTemaExplicito", "respuestaSiNo", "clasificarSeguimiento"]) {
    const i = APP.indexOf(`function ${n}(`), j = APP.indexOf("\n}", i);
    src += APP.slice(i, j + 2) + "\n";
  }
  return new Function(src + "return { clasificarSeguimiento, esSaludoOMeta, tieneTemaExplicito };")();
}

// ── Matemática INDEPENDIENTE (no usa src/) ────────────────────────────────────
const sup = (s) => String(s).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => "^" + "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c));
function evalEn(expr, x) {
  let s = sup(String(expr)).toLowerCase().replace(/\s+/g, "").replace(/[·×]/g, "*").replace(/÷/g, "/")
    .replace(/,/g, ".").replace(/[−–—]/g, "-").replace(/\^/g, "**");
  s = s.replace(/(\d)([a-z(])/g, "$1*$2").replace(/([a-z)])(\()/g, "$1*$2").replace(/(\))(\d|[a-z])/g, "$1*$2");
  s = s.replace(/[a-z]/g, `(${x})`);
  if (!/^[-+*/().0-9 e]+$/.test(s.replace(/\*\*/g, ""))) return null;
  try { const v = Function('"use strict";return(' + s + ")")(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
function resolverLineal(eq) {
  const p = String(eq).split("=");
  if (p.length !== 2) return null;
  const f = (x) => { const a = evalEn(p[0], x), b = evalEn(p[1], x); return a === null || b === null ? null : a - b; };
  const f0 = f(0), f1 = f(1);
  if (f0 === null || f1 === null) return null;
  const m = f1 - f0;
  return Math.abs(m) < 1e-12 ? null : -f0 / m;
}
const num = (s) => {
  const t = String(s).trim().replace(",", ".");
  const fr = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fr) return +fr[1] / +fr[2];
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : NaN;
};
function polinomio(t) {
  let s = sup(String(t)).toLowerCase().replace(/\s+/g, "").replace(/[−–—]/g, "-");
  if (!/^[-+0-9x^.]+$/.test(s)) return null;
  if (!/^[-+]/.test(s)) s = "+" + s;
  const terms = s.match(/[+-](?:\d*\.?\d*x(?:\^\d+)?|\d+\.?\d*)/g);
  if (!terms || terms.join("") !== s) return null;
  const m = new Map();
  for (const tm of terms) {
    const g = tm[0] === "-" ? -1 : 1, b = tm.slice(1);
    if (b.includes("x")) {
      const mm = b.match(/^(\d*\.?\d*)x(?:\^(\d+))?$/); if (!mm) return null;
      m.set(mm[2] ? +mm[2] : 1, (m.get(mm[2] ? +mm[2] : 1) || 0) + g * (mm[1] === "" ? 1 : parseFloat(mm[1])));
    } else m.set(0, (m.get(0) || 0) + g * parseFloat(b));
  }
  return m;
}
const derivar = (f) => { const p = polinomio(f); if (!p) return null; const d = new Map(); for (const [e, c] of p) if (e > 0) d.set(e - 1, (d.get(e - 1) || 0) + c * e); return d; };
const polIgual = (a, b) => { if (!a || !b) return false; for (const k of new Set([...a.keys(), ...b.keys()])) if (Math.abs((a.get(k) || 0) - (b.get(k) || 0)) > 1e-9) return false; return true; };

// ── Estado de sesión, idéntico al del navegador ───────────────────────────────
function nuevaSesion() {
  return { lastTopicQuery: "", previo: "", historial: [], ejercicio: "", respuesta: "", resuelto: "" };
}
// El EJEMPLO que el tutor acaba de resolver (misma regla que extraerEjemploResuelto en app.js):
// la primera pizarra que es una expresión matemática — las de concepto llevan ":" y se descartan.
function ejemploResuelto(pasos) {
  for (const d of pasos) {
    if (d.tipo !== "pizarra" || !d.contenido) continue;
    const c = String(d.contenido).trim();
    if (c.includes(":") || !/\d|x/i.test(c)) continue;
    return c;
  }
  return "";
}
const resumenLeccion = (pasos) => {
  const h = pasos.filter((d) => d.tipo === "hablar").map((d) => d.texto).filter(Boolean).slice(0, 2);
  const p = pasos.filter((d) => d.tipo === "pizarra").map((d) => d.contenido).filter(Boolean);
  const q = pasos.filter((d) => d.tipo === "preguntar").map((d) => d.texto).filter(Boolean);
  return [...p, ...q, ...h].join(" · ").slice(0, 600);
};

async function enviar(S, texto) {
  const F = cargarFrontend(!!S.ejercicio);
  const seg = S.lastTopicQuery ? F.clasificarSeguimiento(texto) : null;
  const body = { query: texto, modo: "ia" };
  if (S.lastTopicQuery) body.currentTopic = S.lastTopicQuery;
  if (S.historial.length) body.historial = S.historial.slice(-5);
  if (S.previo && S.lastTopicQuery) body.previo = S.previo;
  if ((seg === "resolver_otro" || seg === "practicar") && S.ejercicio)
    body.previo = `Ejercicio anterior (NO lo repitas, usa uno DISTINTO): ${S.ejercicio}. ` + (body.previo || "");
  if (seg) { body.contexto = S.lastTopicQuery; body.seguimiento = seg; }
  if (seg === "desglosar") { body.ejercicio = S.ejercicio; body.respuesta = S.respuesta; }
  // "No entendí": se manda el EJEMPLO ya resuelto en pantalla para que re-expliquen ESE.
  if (seg === "reexplicar" && S.resuelto) body.ejercicio = S.resuelto;

  const r = await fetch(BASE + "/api/query", { method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { return { errorNoJson: txt.slice(0, 60) }; }

  const pasos = j.pasos || [];
  const pizarras = pasos.filter((p) => p.tipo === "pizarra").map((p) => p.contenido);
  const dichos = pasos.filter((p) => p.tipo === "hablar").map((p) => p.texto);
  const preg = pasos.find((p) => p.tipo === "preguntar");

  S.historial.push(texto);
  if (!seg && !F.esSaludoOMeta(texto) && (F.tieneTemaExplicito(texto) || !S.lastTopicQuery)) S.lastTopicQuery = texto;
  S.previo = resumenLeccion(pasos);
  if (preg) {
    const qi = pasos.indexOf(preg);
    let board = "";
    for (let i = qi - 1; i >= 0; i--) if (pasos[i].tipo === "pizarra" && pasos[i].contenido) { board = pasos[i].contenido; break; }
    if (board || preg.texto) { S.ejercicio = (board || preg.texto).trim(); S.respuesta = preg.respuesta || ""; }
  }
  const resueltoAhora = ejemploResuelto(pasos);
  const resueltoAntes = S.resuelto;
  if (resueltoAhora) S.resuelto = resueltoAhora;
  return { seg, intencion: j.intencion, fuente: j.fuente_ia, pizarras, dichos, preg,
    resueltoAhora, resueltoAntes,
    texto: [...dichos, ...pizarras, preg?.texto || ""].join(" ") };
}

// ── Comprobaciones ────────────────────────────────────────────────────────────
let ok = 0; const fallos = [];
const check = (cond, msg) => { if (cond) ok++; else fallos.push(msg); };

// Marcas de la lección APLICADA (vida real) en CADA tema. Cuidado con las palabras compartidas:
// "cuadrado" a secas aparece en el CONCEPTO de factorización ("un cuadrado menos otro cuadrado"),
// así que para el escenario geométrico de derivadas se usa su fórmula "A(L)", que es inequívoca.
const APLICADO = new RegExp([
  "un coche", "una planta", "un tanque", "una rampa", "una tienda", "una fábrica", "A\\(L\\)", // derivadas
  "pizza", "chocolate", "presupuesto", "mesada",                                                // fracciones
  "cuadernos", "l[aá]pices", "cumplea[nñ]os",                                                   // lineales
  "l[aá]mina", "recortar", "c[aá]lculo mental",                                                 // factorización
].join("|"), "i");
const MODO = (t) => /¡A practicar!/.test(t) ? "practica" : APLICADO.test(t) ? "aplicado" : "resuelto";

// Verifica, de forma independiente, que la práctica esté bien calificada.
function practicaCorrecta(preg) {
  if (!preg || !String(preg.respuesta || "").trim()) return null; // pregunta de comprensión → no aplica
  const q = preg.texto || "", resp = preg.respuesta;
  let m;
  if ((m = q.match(/vale\s+[a-z]\s+en\s+(.+?)\?/i))) { const x = resolverLineal(m[1]); return x === null ? null : Math.abs(x - num(resp)) < 1e-9; }
  if ((m = q.match(/derivada de (.+?)\?/i))) { const d = derivar(m[1]); return d === null ? null : polIgual(polinomio(resp), d); }
  if ((m = q.match(/(\d+)\/(\d+)\s*\+\s*(\d+)\/(\d+)/))) return Math.abs(num(resp) - ((+m[1]) / (+m[2]) + (+m[3]) / (+m[4]))) < 1e-9;
  if ((m = q.match(/factoriza (.+?)\?/i))) { for (const x of [-3, 0, 2, 5]) { const a = evalEn(m[1], x), b = evalEn(resp, x); if (a === null || b === null || Math.abs(a - b) > 1e-9) return false; } return true; }
  if ((m = q.match(/(\d+)\s*([+\-×÷*/])\s*(\d+)/))) { const a = +m[1], b = +m[3], o = m[2];
    return Math.abs(num(resp) - (o === "+" ? a + b : o === "-" ? a - b : (o === "×" || o === "*") ? a * b : a / b)) < 1e-9; }
  if ((m = q.match(/si la derivada es (\d+)[a-z][^0-9]*(\d+)/i))) return Math.abs(num(resp) - (+m[1] * +m[2])) < 1e-9;
  return null;
}

async function correrSesion(nombre, turnos) {
  console.log(`\n${"═".repeat(78)}\nSESIÓN: ${nombre}`);
  const S = nuevaSesion();
  const vistos = [];
  for (const t of turnos) {
    const r = await enviar(S, t.q);
    if (r.errorNoJson) { check(false, `[${nombre}] "${t.q}" → respuesta NO JSON: ${r.errorNoJson}`); continue; }
    const modo = MODO(r.texto);
    console.log(`  "${t.q}"`.padEnd(56) + ` ${r.fuente.padEnd(6)} ${modo}`);

    // (1) Los 5 temas del alcance NO deben depender de la IA.
    if (t.determinista !== false) check(r.fuente === "local", `[${nombre}] "${t.q}" → fuente=${r.fuente} (debía ser determinista)`);
    // (2) Modo esperado: ejemplo aplicado / ejemplo resuelto / práctica.
    if (t.modo) check(modo === t.modo, `[${nombre}] "${t.q}" → modo ${modo}, esperado ${t.modo}`);
    // (3) El tema no se desvía.
    if (t.debeContener) check(new RegExp(t.debeContener, "i").test(r.texto), `[${nombre}] "${t.q}" → no habla de ${t.debeContener}`);
    if (t.noDebeContener) check(!new RegExp(t.noDebeContener, "i").test(r.texto), `[${nombre}] "${t.q}" → NO debía mencionar ${t.noDebeContener}`);
    // (4) La práctica, si es calificable, debe estar bien calificada.
    const pc = practicaCorrecta(r.preg);
    if (pc !== null) check(pc, `[${nombre}] "${t.q}" → PRÁCTICA MAL CALIFICADA: "${r.preg.texto}" resp=${r.preg.respuesta}`);
    // (5) No repetir la lección anterior palabra por palabra.
    const firma = r.pizarras.join("|");
    if (t.debeVariar) check(!vistos.includes(firma), `[${nombre}] "${t.q}" → REPITE una lección ya mostrada`);
    vistos.push(firma);
    // (6) "No entendí" debe re-explicar EL MISMO problema que hay en pantalla, no cambiar a otro.
    //     "derivada de 3x⁴ - 2x²" cuenta como el mismo que "3x⁴ - 2x²": basta con que uno contenga al otro.
    if (t.mismoProblema) {
      const a = (r.resueltoAntes || "").replace(/\s/g, ""), b = (r.resueltoAhora || "").replace(/\s/g, "");
      check(!!a && !!b && (a === b || b.includes(a) || a.includes(b)),
        `[${nombre}] "${t.q}" → CAMBIÓ de problema: tenía "${r.resueltoAntes}" y ahora "${r.resueltoAhora}"`);
    }
  }
  return vistos;
}

// ══ SESIONES: cómo prueba el cliente de verdad ══
const D = "derivad|pendiente|razón de cambio|potencia";

await correrSesion("Vídeo del cliente (1 ago 2026), literal", [
  { q: "Enséñame derivadas", debeContener: D },
  { q: "dame un ejemplo matemático de derivadas", debeContener: D, debeVariar: true },
  { q: "dame un ejemplo de derivadas diferente al de la velocidad", modo: "aplicado", noDebeContener: "un coche|una planta|un tanque" },
  { q: "dame un ejemplo matemático de derivadas más complejos", debeContener: D, debeVariar: true },
  { q: "enséñame a sumar distintas cantidades con diferentes sumandos", noDebeContener: "fracci" },
]);

await correrSesion("Derivadas: insistir en otro ejemplo (bucle)", [
  { q: "Enséñame las derivadas" },
  { q: "dame un ejemplo de la vida real", modo: "aplicado", debeVariar: true },
  { q: "dame otro ejemplo de la vida real", modo: "aplicado", debeVariar: true },
  { q: "otro de la vida real", modo: "aplicado", debeVariar: true },
  { q: "dame otro ejemplo de la vida real", modo: "aplicado", debeVariar: true },
  { q: "y otro más de la vida real", modo: "aplicado", debeVariar: true },
]);

await correrSesion("Ejemplo ≠ ejercicio (los tres modos)", [
  { q: "Enséñame las derivadas" },
  { q: "dame otro ejemplo", modo: "resuelto", debeVariar: true },
  { q: "dame otro ejemplo diferente", modo: "resuelto", debeVariar: true },
  { q: "dame otro ejercicio", modo: "practica" },
  { q: "quiero practicar", modo: "practica" },
]);

await correrSesion("Ecuaciones lineales: deriva natural del alumno", [
  { q: "Explícame las ecuaciones lineales", debeContener: "ecuaci|despejar|primer grado" },
  { q: "dame otro ejemplo", debeVariar: true },
  { q: "resuélvela" },
  { q: "proponme un problema más difícil", debeVariar: true },
  { q: "ahora uno más fácil", debeVariar: true },
  { q: "no entendí, explícalo mejor" },
]);

await correrSesion("Fracciones y cambio de tema", [
  { q: "Enséñame las fracciones", debeContener: "fracc|denominador" },
  { q: "dame otro ejemplo", debeVariar: true },
  { q: "dame un ejemplo de la vida real", modo: "aplicado" },
  { q: "Enséñame a restar", debeContener: "rest", noDebeContener: "fracci" },
  { q: "dame otro ejemplo", debeVariar: true },
]);

await correrSesion("Factorización", [
  { q: "Explícame la factorización", debeContener: "factoriz|producto|cuadrados" },
  { q: "dame otro ejemplo", debeVariar: true },
  { q: "proponme uno más difícil", debeVariar: true },
  { q: "no entendí" },
]);

// "No entendí" NO debe cambiar de problema, en los CINCO temas. Queja del cliente: pedía uno más
// difícil, no lo entendía, y en vez de re-explicárselo le cambiaban el ejercicio.
for (const [tema, abre, duro] of [
  ["ecuaciones lineales", "Enséñame ecuaciones lineales", "Por favor, dame un problema más difícil."],
  ["derivadas", "Enséñame derivadas", "dame un problema más difícil"],
  ["factorización", "Explícame la factorización", "dame uno más difícil"],
  ["fracciones", "Enséñame las fracciones", "dame uno más difícil"],
  ["aritmética", "Enséñame a sumar", "dame uno más difícil"],
]) {
  await correrSesion(`"No entendí" mantiene el problema — ${tema}`, [
    { q: abre },
    { q: duro, debeVariar: true },
    { q: "no entendí", mismoProblema: true },
  ]);
}

console.log("\n" + "═".repeat(78));
console.log(`Comprobaciones OK: ${ok} · Fallidas: ${fallos.length}`);
for (const f of fallos) console.log("  ✗ " + f);
console.log(fallos.length === 0
  ? "\n✅ SESIONES SUPERADAS — el sistema se comporta bien conversando, no solo en consultas sueltas."
  : "\n❌ HAY FALLOS DE SESIÓN");
process.exit(fallos.length === 0 ? 0 : 1);
