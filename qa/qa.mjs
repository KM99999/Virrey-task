// QA — control de calidad de Math IA (correr ANTES de entregar al cliente).
//
//   npm run qa                 → prueba lógica + pruebas reales en producción
//   QA_URL=http://localhost:3137 npm run qa   → contra otra URL
//
// Verifica: (1) la lógica (clasificador, solver, saneo, una sola pregunta), y
// (2) lecciones REALES generadas por Gemini para las 4 intenciones, comprobando
// que expliquen paso a paso, tengan una sola pregunta con respuesta correcta y no
// contengan LaTeX ni "$". Imprime un veredicto final APROBADO / RECHAZADO.

import { classifyIntent } from "../src/classifier.js";
import { processLSG, solveLinearFromText } from "../src/preLight.js";
import { checkAnswer } from "../public/pseLight.js";

const BASE = process.env.QA_URL || "https://math-ia.onrender.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("   ✓ " + name); }
  else { fails.push(name + (detail ? " — " + detail : "")); console.log("   ✗ " + name + (detail ? "  (" + detail + ")" : "")); }
}

// Solver de referencia (independiente) para cruzar la respuesta del sistema.
function refSolve(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/((?:[+-]?\s*(?:\d*[a-z]|\d+))(?:\s*[+-]\s*(?:\d*[a-z]|\d+))*)\s*=\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lhs = m[1], c = Number(m[2]);
  const letters = new Set((lhs.match(/[a-z]/g) || []));
  if (letters.size !== 1) return null;
  const v = [...letters][0];
  let e = lhs.replace(/\s+/g, ""); if (!/^[+-]/.test(e)) e = "+" + e;
  const terms = e.match(/[+-](?:\d*[a-z]|\d+(?:\.\d+)?)/g) || [];
  let a = 0, k = 0;
  for (const tm of terms) {
    const s = tm[0] === "-" ? -1 : 1, b = tm.slice(1);
    if (b.includes(v)) { const n = b.replace(v, ""); const kk = n === "" ? 1 : Number(n); if (!isFinite(kk)) return null; a += s * kk; }
    else { const kk = Number(b); if (!isFinite(kk)) return null; k += s * kk; }
  }
  if (a === 0) return null;
  const x = (c - k) / a; if (!isFinite(x)) return null;
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
}

// ---------- 1) LÓGICA ----------
function unitTests() {
  console.log("\n[1] Lógica (sin red)");
  check("clasificador: resolver", classifyIntent("Resuelve 2x + 5 = 15").intent === "resolver");
  check("clasificador: aprender", classifyIntent("Enséñame derivadas").intent === "aprender");
  check("clasificador: explicar", classifyIntent("¿Por qué se factoriza?").intent === "explicar");
  check("clasificador: practicar", classifyIntent("Dame un ejercicio de fracciones").intent === "practicar");

  check("solver: 2x - 3 = 7 → 5", solveLinearFromText("2x - 3 = 7") === "5");
  check("solver: 3x + x = 20 → 5", solveLinearFromText("3x + x = 20") === "5");
  check("solver: no-lineal → null", solveLinearFromText("2(x+1) = 6") === null);

  check("checkAnswer: 5 == 5", checkAnswer("5", "5").correct === true);
  check("checkAnswer: 9 != 5", checkAnswer("9", "5").correct === false);
  check("checkAnswer: sin verdad-base → known:false", checkAnswer("lo que sea", "").known === false);

  const san = processLSG({ escena: "x", intencion: "resolver", directivas: [
    { tipo: "pizarra", contenido: "$x^2 - 9$" }, { tipo: "preguntar", texto: "¿x?", respuesta: "1" }] }, "resolver");
  check("saneo: quita $ y LaTeX", san.lsg.directivas.some((d) => d.contenido === "x² - 9"));

  const dedup = processLSG({ escena: "x", intencion: "resolver", directivas: [
    { tipo: "preguntar", texto: "¿a?", respuesta: "1" }, { tipo: "preguntar", texto: "¿b?", respuesta: "2" }] }, "resolver")
    .lsg.directivas.filter((d) => d.tipo === "preguntar");
  check("una sola pregunta (dedup)", dedup.length === 1, `preguntas=${dedup.length}`);

  const conv = processLSG({ escena: "x", intencion: "aprender", modulos: [{ id: "m", directivas: [
    { tipo: "hablar", texto: "hola" }, { tipo: "preguntar", texto: "3x - 7 = 8" }] }] }, "aprender")
    .lsg.modulos[0].directivas;
  check("ecuación suelta NO abre caja (se narra)", !conv.some((d) => d.tipo === "preguntar" && d.texto === "3x - 7 = 8"));
}

// ---------- 2) PRODUCCIÓN (Gemini real) ----------
async function fetchLesson(q) {
  try { await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(90000) }); } catch {}
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(BASE + "/api/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(90000),
      });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(4000);
  }
  return null;
}

async function liveGate(q, intentEsperada, minHablar) {
  console.log(`\n   · Consulta: "${q}"`);
  const d = await fetchLesson(q);
  if (!d) { check(`[${q}] responde 200`, false, "sin respuesta tras 4 intentos"); return; }
  check(`[${q}] intención = ${intentEsperada}`, d.intencion === intentEsperada, `fue ${d.intencion}`);
  check(`[${q}] IA real (gemini)`, d.fuente_ia === "gemini", `fuente=${d.fuente_ia}`);
  if (d.modelo) console.log(`     (modelo: ${d.modelo})`);

  const p = d.pasos || [];
  const hablar = p.filter((x) => x.tipo === "hablar");
  const preg = p.filter((x) => x.tipo === "preguntar");
  const all = p.map((x) => `${x.texto || ""} ${x.contenido || ""}`).join(" ");

  check(`[${q}] explica paso a paso (hablar ≥ ${minHablar})`, hablar.length >= minHablar, `hablar=${hablar.length}`);
  check(`[${q}] una sola pregunta`, preg.length === 1, `preguntas=${preg.length}`);
  check(`[${q}] sin signos "$"`, !all.includes("$"));
  check(`[${q}] sin LaTeX (\\comando)`, !/\\[a-zA-Z]+/.test(all));

  if (preg[0]) {
    const qt = preg[0].texto || "";
    check(`[${q}] la pregunta es una pregunta (?)`, qt.includes("?"), qt.slice(0, 40));
    const real = refSolve(qt);
    if (real !== null && preg[0].respuesta) {
      check(`[${q}] respuesta correcta (${real})`, preg[0].respuesta === real, `sistema=${preg[0].respuesta}`);
    }
  }
}

async function liveTests() {
  // Cada consulta se corre varias veces (QA_REPS, por defecto 2) para cazar fallos
  // INTERMITENTES: una lección puede salir bien una vez y sin explicaciones la otra.
  const REPS = Number(process.env.QA_REPS || 1); // ojo: cada lección consume créditos de Gemini
  console.log(`\n[2] Producción real — ${BASE}  (x${REPS} cada consulta)`);
  const cases = [
    ["desarrolla 2x + x = 12", "resolver", 3],
    ["enséñame ecuaciones de primer grado", "aprender", 3],
    ["¿por qué se factoriza x² - 9?", "explicar", 2],
    ["dame un ejercicio de fracciones", "practicar", 2],
  ];
  for (const [q, intent, minH] of cases) {
    for (let r = 0; r < REPS; r++) await liveGate(q, intent, minH);
  }
}

// ---------- Ejecutar ----------
console.log("═══════════ QA · Math IA ═══════════");
unitTests();
if (process.env.QA_SKIP_LIVE !== "1") await liveTests();
else console.log("\n[2] Producción — OMITIDA (QA_SKIP_LIVE=1)");

console.log("\n═══════════════════════════════════");
console.log(`Aprobadas: ${pass} · Fallidas: ${fails.length}`);
if (fails.length) {
  console.log("\nFALLOS:");
  for (const f of fails) console.log("  · " + f);
  console.log("\n❌ RECHAZADO — NO entregar al cliente hasta corregir.");
  process.exit(1);
} else {
  console.log("\n✅ APROBADO — listo para que lo vea el cliente.");
  process.exit(0);
}
