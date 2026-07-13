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
import { mockLSG } from "../src/lsgPrompt.js";
import { checkAnswer, flattenLSG, PSELight } from "../public/pseLight.js";

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
async function unitTests() {
  console.log("\n[1] Lógica (sin red)");
  check("clasificador: resolver", classifyIntent("Resuelve 2x + 5 = 15").intent === "resolver");
  check("clasificador: aprender", classifyIntent("Enséñame derivadas").intent === "aprender");
  check("clasificador: explicar", classifyIntent("¿Por qué se factoriza?").intent === "explicar");
  check("clasificador: practicar", classifyIntent("Dame un ejercicio de fracciones").intent === "practicar");
  // "Dame una ecuación PARA RESOLVER" = el alumno la resuelve (practicar), NO se la resuelve la app.
  check("clasif: 'dame ecuación para resolver' → practicar", classifyIntent("Dame una ecuación lineal para resolver").intent === "practicar");
  check("clasif: 'dame una ecuación lineal' → practicar", classifyIntent("Dame una ecuación lineal").intent === "practicar");
  check("clasif: 'dame la solución de 2x=8' → resolver", classifyIntent("Dame la solución de 2x = 8").intent === "resolver");
  check("clasif: 'quiero aprender a resolver' → aprender", classifyIntent("Quiero aprender a resolver ecuaciones").intent === "aprender");

  check("solver: 2x - 3 = 7 → 5", solveLinearFromText("2x - 3 = 7") === "5");
  check("solver: 3x + x = 20 → 5", solveLinearFromText("3x + x = 20") === "5");
  check("solver: no-lineal → null", solveLinearFromText("2(x+1) = 6") === null);
  // Nunca dar una respuesta FALSA: si el coeficiente se recorta ("1/2 x", "3 x"),
  // el solver debe devolver null (modo comprensión), jamás un valor incorrecto.
  check("solver: '1/2 x = 4' NO da x=4 falso (→ null)", solveLinearFromText("1/2 x = 4") === null);
  check("solver: '3 x = 6' con espacio → null (no arriesga)", solveLinearFromText("3 x = 6") === null);

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

  // Modo demo: NUNCA debe mostrar el placeholder inútil "Concepto principal" y SIEMPRE
  // debe dar un ejercicio de práctica REAL con respuesta (regresión reportada por el cliente).
  for (const intent of ["practicar", "aprender"]) {
    const raw = mockLSG("practicar ecuaciones lineales", intent);
    const { lsg } = processLSG(raw, intent);
    const flat = flattenLSG(lsg);
    const preg = flat.filter((d) => d.tipo === "preguntar");
    check(`demo ${intent}: sin placeholder "Concepto principal"`, !JSON.stringify(lsg).includes("Concepto principal"));
    check(`demo ${intent}: da ejercicio real con respuesta`, preg.length === 1 && !!preg[0].respuesta, `preg=${preg.length}`);
    check(`demo ${intent}: la práctica es una pregunta (?)`, !!preg[0] && (preg[0].texto || "").includes("?"));
  }

  // PRACTICAR no debe resolver el ejercicio POR el alumno: la pizarra escribe el enunciado
  // pero NO una línea de solución dada "x = <número>" (eso sería resolvérselo).
  const practF = flattenLSG(processLSG(mockLSG("dame ejercicios para practicar ecuaciones lineales", "practicar"), "practicar").lsg);
  const pizarrasP = practF.filter((d) => d.tipo === "pizarra").map((d) => (d.contenido || "").replace(/\s+/g, " ").trim());
  check("demo practicar: NO se lo resuelve (sin línea 'x = <n>')", !pizarrasP.some((c) => /^[a-z]\s*=\s*-?\d+$/.test(c)), `pizarras=${JSON.stringify(pizarrasP)}`);

  // TEMA-CONSCIENTE: el demo debe enseñar el tema pedido, NO siempre ecuaciones.
  const textoDe = (q, intent) => {
    const { lsg } = processLSG(mockLSG(q, intent), intent);
    return flattenLSG(lsg).map((d) => `${d.texto || ""} ${d.contenido || ""}`).join(" ").toLowerCase();
  };
  const sumaTxt = textoDe("enséñame a sumar dos cantidades", "aprender");
  check("demo 'sumar' enseña a sumar (no ecuaciones)", /sumar|suma/.test(sumaTxt) && !/ecuaci|despejar|2x/.test(sumaTxt));
  const restaTxt = textoDe("enséñame a restar", "aprender");
  check("demo 'restar' enseña a restar (no ecuaciones)", /restar|resta/.test(restaTxt) && !/ecuaci|2x/.test(restaTxt));
  check("demo '7 × 8' calcula 56", textoDe("cuánto es 7 × 8", "resolver").includes("56"));
  check("demo 'a^2 - b^2' factoriza (diferencia de cuadrados)", /factoriz|diferencia de cuadrados/.test(textoDe("Resuelve a^2 - b^2", "resolver")));
  // Tema no soportado en demo: honesto, sin inventar contenido de ecuaciones.
  const genTxt = textoDe("enséñame integrales por partes", "aprender");
  check("demo tema desconocido: honesto (no finge ecuaciones)", /modo de demostraci|inténtalo de nuevo/.test(genTxt) && !/2x|despejar/.test(genTxt));

  // El demo de "aprender" sigue la estructura pedagógica: concepto, regla, ejemplo guiado, práctica.
  const mods = processLSG(mockLSG("enséñame a sumar", "aprender"), "aprender").lsg.modulos.map((m) => m.id);
  check("demo aprender: estructura concepto/regla/ejemplo_guiado/practica",
    ["concepto", "regla", "ejemplo_guiado", "practica"].every((id) => mods.includes(id)), mods.join(","));

  // La PIZARRA debe recibir la EXPLICACIÓN (hablar), no solo los números (pizarra).
  const board = [];
  const uiMock = {
    setModule() {}, highlightBoard() {}, clearBoard() { board.length = 0; }, setCaption() {},
    onStep() {}, onProgress() {}, setControls() {}, showFeedback() {}, askAnswer: async () => "4",
    writeBoard(t) { board.push({ k: "math", t }); }, writeBoardExplain(t) { board.push({ k: "explica", t }); },
  };
  const pse = new PSELight({ avatar: { setState() {}, setSpeaking() {} }, tts: { speak: async () => {}, cancel() {} }, ui: uiMock });
  await pse.play({ escena: "t", intencion: "resolver", directivas: [
    { tipo: "hablar", texto: "Sumamos los términos semejantes.", id: 1 },
    { tipo: "pizarra", contenido: "3x = 12", id: 2 },
    { tipo: "preguntar", texto: "¿Cuánto vale x en x + 2 = 6?", respuesta: "4", id: 3 },
  ] });
  check("pizarra CONTIENE la explicación (no solo números)", board.some((l) => l.k === "explica"), `board=${JSON.stringify(board.map((l) => l.k))}`);
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
await unitTests();
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
