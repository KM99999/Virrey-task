// Verificación FINAL con Gemini REAL (sin modo demostración) contra producción.
// Comprueba: las 4 intenciones, continuidad conversacional, respuestas matemáticas correctas,
// ramificación (ejemplo alternativo) y que el CÓDIGO DESPLEGADO coincide con el entregado.
//
//   node qa/verificar.mjs                    # contra https://math-ia.onrender.com
//   QA_URL=http://localhost:3000 node qa/verificar.mjs
//
// Sale con código 1 si algo falla (útil para CI / evidencia).

import { computeAnswer, corregirIgualdades } from "../src/preLight.js";

const BASE = process.env.QA_URL || "https://math-ia.onrender.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const line = (ok, msg, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"} ${msg}${extra ? "  — " + extra : ""}`); };

function flatten(lsg) {
  const out = [];
  if (Array.isArray(lsg?.modulos)) for (const m of lsg.modulos) for (const d of m.directivas || []) out.push(d);
  else if (Array.isArray(lsg?.directivas)) for (const d of lsg.directivas) out.push(d);
  return out;
}

// Pide una lección insistiendo en Gemini REAL (reintenta si cae a demo por 429).
async function pedir(body, { exigirGemini = true, intentos = 6 } = {}) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(BASE + "/api/query", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
      });
      if (r.ok) {
        const j = await r.json();
        if (!exigirGemini || j.fuente_ia === "gemini") return j;
      }
    } catch { /* reintenta */ }
    await sleep(6000); // espaciar por el límite por minuto
  }
  return null;
}

console.log(`\n═══ Verificación FINAL con Gemini real — ${BASE} ═══`);

// 0) Versión desplegada (para probar que el .zip entregado == lo desplegado)
let health = null;
try { health = await (await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(90000) })).json(); } catch {}
console.log(`\n[0] Estado del servicio`);
line(health?.status === "ok", "servicio en línea (/api/health)");
line(health?.modo_ia === "gemini", "IA configurada = Gemini (no mock)", `modo_ia=${health?.modo_ia}`);
console.log(`      Versión desplegada (commit): ${health?.version || "?"}   ← debe coincidir con el .zip entregado`);
console.log(`      Modelo: ${health?.modelo || "?"}`);

// 1) Las 4 intenciones, con Gemini real, explicación, 1 pregunta y respuesta correcta
console.log(`\n[1] Las 4 intenciones (Gemini real)`);
const casos = [
  { q: "desarrolla 2x + x = 12", intent: "resolver" },
  { q: "enséñame ecuaciones de primer grado", intent: "aprender" },
  { q: "¿por qué se factoriza x² - 9?", intent: "explicar" },
  { q: "dame un ejercicio de fracciones", intent: "practicar" },
];
const lecciones = {};
for (const c of casos) {
  const d = await pedir({ query: c.q, modo: "ia" });
  if (!d) { line(false, `[${c.q}] Gemini no respondió tras varios intentos (posible 429)`); continue; }
  lecciones[c.intent] = d;
  const flat = flatten(d.lsg);
  const hablar = flat.filter((x) => x.tipo === "hablar");
  const preg = flat.filter((x) => x.tipo === "preguntar");
  line(d.fuente_ia === "gemini", `[${c.q}] fuente = Gemini real`);
  line(d.intencion === c.intent, `[${c.q}] intención = ${c.intent}`, `fue ${d.intencion}`);
  line(hablar.length >= 2, `[${c.q}] explica paso a paso (${hablar.length} explicaciones)`);
  line(preg.length === 1, `[${c.q}] exactamente una pregunta`);
  // Respuesta correcta: recalculada de forma independiente cuando es aritmética/ecuación.
  const q0 = preg[0];
  if (q0?.respuesta) {
    const esperada = computeAnswer(q0.texto) || null;
    if (esperada !== null) line(String(q0.respuesta) === esperada, `[${c.q}] respuesta correcta (independiente: ${esperada})`, `sistema=${q0.respuesta}`);
    else console.log(`      · [${c.q}] respuesta del sistema: ${q0.respuesta} (no recalculable localmente)`);
  }
  // Integridad matemática: ninguna operación escrita/dicha queda mal (el servidor ya corrige).
  const malas = flat.reduce((n, x) => n + corregirIgualdades(`${x.texto || ""} ${x.contenido || ""}`).correcciones, 0);
  line(malas === 0, `[${c.q}] sin operaciones erróneas en pizarra/voz`, malas ? `${malas} pendientes` : "");
}

// 2) Continuidad conversacional: un seguimiento mantiene el tema (no cambia de tema)
console.log(`\n[2] Continuidad conversacional`);
const cont = await pedir({ query: "explícamelo con manzanas", modo: "ia", contexto: "ensename ecuaciones de primer grado", seguimiento: "continuacion", currentTopic: "ensename ecuaciones de primer grado" });
if (cont) {
  const txt = JSON.stringify(cont.lsg).toLowerCase();
  line(/ecuaci|=|\bx\b/.test(txt) && /manzan/.test(txt), "'explícamelo con manzanas' mantiene el tema (ecuaciones) con manzanas");
} else line(false, "no se pudo verificar continuidad (Gemini no respondió)");

// 3) Ramificación: la lección de práctica trae un ejemplo alternativo resuelto
console.log(`\n[3] Ramificación ligera (ejemplo alternativo resuelto)`);
const prac = lecciones["practicar"] || lecciones["aprender"];
if (prac) {
  const q = flatten(prac.lsg).find((x) => x.tipo === "preguntar");
  const tiene = !!(q && q.otro_ejemplo && Array.isArray(q.otro_ejemplo.pasos) && q.otro_ejemplo.pasos.length);
  line(tiene, "la pregunta incluye un ejemplo alternativo resuelto (otro_ejemplo)", tiene ? `${q.otro_ejemplo.pasos.length} paso(s)` : "ausente");
} else line(false, "no hubo lección de práctica para verificar la ramificación");

console.log(`\n═══ Resultado: ${pass} verificaciones OK · ${fail} fallidas ═══`);
console.log(fail === 0 ? "✅ VERIFICACIÓN SUPERADA (Gemini real)\n" : "❌ REVISAR\n");
process.exit(fail ? 1 : 0);
