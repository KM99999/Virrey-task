// ¿ARRANCA LA APLICACIÓN EN EL NAVEGADOR?
//
// Por qué existe: TODAS las demás pruebas hablan con el SERVIDOR. Si `public/app.js` lanza un error
// al cargarse, la página queda muerta —pizarra en blanco, botones sin responder— y las cuatro
// baterías siguen en verde, porque el servidor está perfectamente. Es el punto ciego más grande que
// tenía el proyecto, y no es teórico: al guardar el cursor de rotación en la sesión, la llamada que
// restaura el estado quedó ANTES de las declaraciones que usa, lo que revienta el módulo entero al
// cargarlo. Esta prueba lo detecta; ninguna otra lo haría.
//
// Se carga app.js sobre un DOM mínimo simulado (no es un navegador de verdad: no comprueba cómo se
// ve ni cómo suena, solo que el módulo se ejecuta de principio a fin sin lanzar).
//
//   node qa/frontend.mjs
import { readFileSync } from "node:fs";

const RAIZ = new URL("../public/", import.meta.url);
const HTML = readFileSync(new URL("index.html", RAIZ), "utf8");
const ids = new Set([...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const nodo = (id) => ({
  id, hidden: false, disabled: false, textContent: "", innerHTML: "", value: "", max: "", src: "",
  dataset: {}, style: {}, children: [], firstChild: null, lastChild: null, parentNode: null,
  offsetWidth: 0, offsetHeight: 0, scrollHeight: 0, scrollTop: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, focus() {}, blur() {},
  click() {}, scrollIntoView() {}, scrollTo() {}, insertBefore() {}, remove() {}, append() {}, prepend() {},
  replaceChildren() {}, before() {}, after() {}, contains: () => false,
  setAttribute() {}, setAttributeNS() {}, getAttribute: () => null, closest: () => null,
  querySelector: () => null, querySelectorAll: () => [], cloneNode: () => nodo(id),
  getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
});
const cache = new Map();
const get = (id) => { if (!cache.has(id)) cache.set(id, nodo(id)); return cache.get(id); };

const almacen = new Map();
const g = globalThis;
g.window = { speechSynthesis: null, SpeechRecognition: null, webkitSpeechRecognition: null,
  addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { href: "http://localhost/" } };
g.document = {
  getElementById: (id) => (ids.has(id) ? get(id) : null),
  querySelector: () => nodo("q"), querySelectorAll: () => [],
  createElement: (t) => nodo(t), createElementNS: (_ns, t) => nodo(t),
  addEventListener() {}, body: nodo("body"), documentElement: nodo("html"), readyState: "complete",
};
g.sessionStorage = { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)), removeItem: (k) => almacen.delete(k) };
g.localStorage = g.sessionStorage;
g.navigator = { language: "es-ES", userAgent: "node", mediaDevices: undefined };
g.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
g.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ pasos: [], lsg: {}, cursores: {} }) });
g.alert = () => {};

let ok = 0; const fallos = [];
async function cargar(nombre, sesion) {
  if (sesion === null) almacen.delete("mathia:sesion");
  else almacen.set("mathia:sesion", sesion);
  try {
    // La query hace que el módulo se vuelva a EVALUAR en cada caso (si no, Node lo cachearía y solo
    // se probaría el primero).
    await import(new URL(`app.js?caso=${encodeURIComponent(nombre)}`, RAIZ).href);
    console.log(`  ✓ ${nombre}`); ok++;
  } catch (e) {
    console.log(`  ✗ ${nombre} — ${e.message}`); fallos.push(`${nombre}: ${e.message}`);
  }
}

console.log("═══ Carga del frontend (public/app.js) ═══\n");
// Sesión limpia (primera visita) y sesión guardada (recarga con F5): son caminos DISTINTOS, porque al
// recargar se restauran tema, historial, cursor de rotación y expresiones ya vistas.
await cargar("primera visita (sin sesión guardada)", null);
await cargar("recarga F5 con sesión guardada", JSON.stringify({
  lastTopicQuery: "Enséñame derivadas", historial: ["Enséñame derivadas", "otro ejemplo"],
  lastLessonSummary: "x² · 2x³", lastExercise: { ejercicio: "x⁴", respuesta: "4x³" },
  lastResuelto: "x²", cursores: { "derivada:normal": 3, "frase_practica:intro": 1 }, vistas: ["x²", "2x³"],
}));
// Sesión corrupta o manipulada: el estado vive en el navegador del alumno, así que puede llegar roto
// (versión anterior, otra pestaña, edición manual). Nunca debe impedir que la aplicación arranque.
for (const [nombre, valor] of [
  ["sesión con JSON inválido", "{no es json"],
  ["sesión con cursores manipulados", JSON.stringify({ cursores: { "../../x": 1, "derivada:normal": "9", "a:b": 99999 } })],
  ["sesión con cursores como array", JSON.stringify({ cursores: [1, 2, 3] })],
  ["sesión con tipos equivocados", JSON.stringify({ lastTopicQuery: 42, historial: "no soy array", vistas: { a: 1 } })],
  ["sesión null", "null"],
  ["sesión vacía", ""],
]) await cargar(nombre, valor);

// ── ORDEN de la restauración de sesión ──────────────────────────────────────────────────────────
// Comprobación aparte, y hace falta: `restoreSession()` restaura el cursor de rotación y las
// expresiones vistas, declaradas con `const` más abajo. Si la llamada quedara ANTES de esas
// declaraciones, el acceso lanzaría ReferenceError… que la propia función SE TRAGA con su try/catch.
// O sea: la página cargaría igual, sin ningún error visible, pero el cursor NO se restauraría y al
// recargar la rotación empezaría de cero — el alumno vuelve a ver el primer ejemplo. Un fallo mudo
// que la prueba de carga de arriba no puede ver (se comprobó inyectándolo a propósito: cargaba bien).
{
  const src = readFileSync(new URL("app.js", RAIZ), "utf8");
  const llamada = src.indexOf("\nrestoreSession();");
  const declCursor = src.indexOf("const cursoresRotacion");
  const declVistas = src.indexOf("const expresionesVistas");
  const bien = llamada > declCursor && llamada > declVistas && declCursor > 0 && declVistas > 0;
  console.log(`  ${bien ? "✓" : "✗"} restoreSession() se llama DESPUÉS de declarar cursor y expresiones vistas`);
  if (!bien) fallos.push("restoreSession() se llama antes de las declaraciones que restaura: el cursor no se restauraría (fallo silencioso)");
  else ok++;
  // Y una sola vez: dos llamadas duplicarían las expresiones vistas.
  const veces = (src.match(/\nrestoreSession\(\);/g) || []).length;
  console.log(`  ${veces === 1 ? "✓" : "✗"} restoreSession() se llama exactamente una vez (${veces})`);
  if (veces !== 1) fallos.push(`restoreSession() se llama ${veces} veces`); else ok++;
}

console.log(`\n${"═".repeat(60)}`);
console.log(`Cargas correctas: ${ok} · Fallidas: ${fallos.length}`);
if (fallos.length) { for (const f of fallos) console.log("  · " + f); console.log("\n❌ El frontend NO arranca."); process.exit(1); }
console.log("\n✅ El frontend arranca en todos los casos.");
process.exit(0);   // app.js deja temporizadores vivos (los del navegador): salimos a mano
