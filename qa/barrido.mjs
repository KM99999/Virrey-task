// BARRIDO por PROPIEDADES — busca defectos SIN saber de antemano cuáles son.
//
// Por qué existe: qa.mjs y qa/sesiones.mjs comprueban lo que ESPERAMOS. El cliente encuentra lo
// que no se nos ocurrió comprobar. Aquí no se afirma "esto debe dar X": se generan MUCHAS
// conversaciones realistas y se exigen INVARIANTES que deben cumplirse en cualquier camino.
// Si una se rompe, el barrido imprime la conversación exacta que la rompió, lista para reproducir.
//
//   node qa/barrido.mjs                                 (contra producción)
//   MATHIA_URL=http://localhost:3000 node qa/barrido.mjs
//   BARRIDO_TURNOS=10 BARRIDO_SEC=20 node qa/barrido.mjs
import { readFileSync } from "node:fs";

const BASE = process.env.MATHIA_URL || "https://math-ia.onrender.com";
const TURNOS = Number(process.env.BARRIDO_TURNOS || 8);
const SECUENCIAS = Number(process.env.BARRIDO_SEC || 14);

// ── funciones REALES del frontend (deciden el seguimiento, como el navegador) ──
const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function FE(ej, resuelto) {
  let s = `let lastExercise=${ej ? JSON.stringify(ej) : "null"}; let lastResuelto=${JSON.stringify(resuelto || "")}; let lastParte="";\n`;
  for (const n of ["esSaludoOMeta", "esSeguimiento", "ajusteNivel", "esContinuacion", "pidePasos",
    "pideOtroEjercicio", "pideResolverOtro", "pideResolverActual", "nombraOtroTema", "tieneTemaExplicito", "respuestaSiNo", "clasificarSeguimiento"]) {
    const i = APP.indexOf(`function ${n}(`), j = APP.indexOf("\n}", i);
    s += APP.slice(i, j + 2) + "\n";
  }
  return new Function(s + "return {clasificarSeguimiento,esSaludoOMeta,tieneTemaExplicito};")();
}

// ── matemática INDEPENDIENTE (no usa src/) ────────────────────────────────────
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
  const p = String(eq).split("="); if (p.length !== 2) return null;
  const f = (x) => { const a = evalEn(p[0], x), b = evalEn(p[1], x); return a === null || b === null ? null : a - b; };
  const f0 = f(0), f1 = f(1); if (f0 === null || f1 === null) return null;
  const m = f1 - f0; return Math.abs(m) < 1e-12 ? null : -f0 / m;
}
const num = (s) => { const t = String(s).trim().replace(",", "."); const fr = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (fr) return +fr[1] / +fr[2]; const n = parseFloat(t); return Number.isFinite(n) ? n : NaN; };
function poli(t) {
  let s = sup(String(t)).toLowerCase().replace(/\s+/g, "").replace(/[−–—]/g, "-");
  if (!/^[-+0-9x^.]+$/.test(s)) return null;
  if (!/^[-+]/.test(s)) s = "+" + s;
  const terms = s.match(/[+-](?:\d*\.?\d*x(?:\^\d+)?|\d+\.?\d*)/g);
  if (!terms || terms.join("") !== s) return null;
  const m = new Map();
  for (const tm of terms) { const g = tm[0] === "-" ? -1 : 1, b = tm.slice(1);
    if (b.includes("x")) { const mm = b.match(/^(\d*\.?\d*)x(?:\^(\d+))?$/); if (!mm) return null;
      const e = mm[2] ? +mm[2] : 1; m.set(e, (m.get(e) || 0) + g * (mm[1] === "" ? 1 : parseFloat(mm[1]))); }
    else m.set(0, (m.get(0) || 0) + g * parseFloat(b)); }
  return m;
}
const derivar = (f) => { const p = poli(f); if (!p) return null; const d = new Map(); for (const [e, c] of p) if (e > 0) d.set(e - 1, (d.get(e - 1) || 0) + c * e); return d; };
const polIgual = (a, b) => { if (!a || !b) return false; for (const k of new Set([...a.keys(), ...b.keys()])) if (Math.abs((a.get(k) || 0) - (b.get(k) || 0)) > 1e-9) return false; return true; };

// Comprueba la práctica de forma independiente. null = no aplica (pregunta de comprensión).
function practicaOK(preg) {
  if (!preg || !String(preg.respuesta || "").trim()) return null;
  const q = preg.texto || "", r = preg.respuesta;
  let m;
  if ((m = q.match(/vale\s+[a-z]\s+en\s+(.+?)\?/i))) { const x = resolverLineal(m[1]); return x === null ? null : Math.abs(x - num(r)) < 1e-9; }
  if ((m = q.match(/derivada de (.+?)\?/i))) { const d = derivar(m[1]); return d === null ? null : polIgual(poli(r), d); }
  if ((m = q.match(/(\d+)\/(\d+)\s*\+\s*(\d+)\/(\d+)/))) return Math.abs(num(r) - ((+m[1]) / (+m[2]) + (+m[3]) / (+m[4]))) < 1e-9;
  if ((m = q.match(/factoriza (.+?)\?/i))) { for (const x of [-3, 0, 2, 5, 7.5]) { const a = evalEn(m[1], x), b = evalEn(r, x); if (a === null || b === null || Math.abs(a - b) > 1e-9) return false; } return true; }
  if ((m = q.match(/(\d+)\s*([+\-×÷*/])\s*(\d+)/))) { const a = +m[1], b = +m[3], o = m[2];
    return Math.abs(num(r) - (o === "+" ? a + b : o === "-" ? a - b : (o === "×" || o === "*") ? a * b : a / b)) < 1e-9; }
  if ((m = q.match(/si la derivada es (\d+)[a-z][^0-9]*(\d+)/i))) return Math.abs(num(r) - (+m[1] * +m[2])) < 1e-9;
  return null;
}

// ── estado de sesión, igual que el navegador ──────────────────────────────────
const resumen = (p) => {
  const h = p.filter((x) => x.tipo === "hablar").map((x) => x.texto).filter(Boolean).slice(0, 2);
  const pz = p.filter((x) => x.tipo === "pizarra").map((x) => x.contenido).filter(Boolean);
  const q = p.filter((x) => x.tipo === "preguntar").map((x) => x.texto).filter(Boolean);
  return [...pz, ...q, ...h].join(" · ").slice(0, 600);
};
const MARCAS_CONCEPTO = new RegExp(["raz[oó]n de cambio","cu[aá]nto sube o baja","numerador / denominador",
  "cu[aá]ntas partes tomo","producto de factores","deshacer una multiplicaci[oó]n","ecuaci[oó]n lineal: a",
  "juntar cantidades","quitar una cantidad de otra","sumar el mismo n[uú]mero","repartir en partes iguales",
  "un coche","una planta","un tanque","una rampa","una tienda","una f[aá]brica","A\\(L\\)","pizza","chocolate",
  "presupuesto","cuadernos","l[aá]mina","recortar","c[aá]lculo mental"].join("|"), "i");
const ejResuelto = (pasos) => {
  for (const d of pasos) { if (d.tipo !== "pizarra" || !d.contenido) continue;
    const c = String(d.contenido).trim(); if (c.includes(":") || !/\d|x/i.test(c)) continue; return c; }
  return "";
};

const OPEN = [
  ["lineales", "Enséñame ecuaciones lineales"], ["lineales", "Resuelve 2x + 5 = 15"],
  ["derivadas", "Enséñame derivadas"], ["derivadas", "deriva 3x²"],
  ["factorización", "Explícame la factorización"], ["factorización", "factoriza x² - 9"],
  ["fracciones", "Enséñame las fracciones"], ["fracciones", "Resuelve 1/2 + 1/3"],
  ["aritmética", "Enséñame a sumar"], ["aritmética", "Resuelve 47 + 38"],
];
const SEGS = [
  "dame otro ejemplo", "otro ejemplo diferente", "muéstrame otros ejemplos", "y otro más",
  "no entendí", "no lo entendí", "explícalo mejor", "dame un problema más difícil",
  "ahora uno más fácil", "dame un ejercicio", "quiero practicar", "resuélvela",
  "explícame los pasos", "dame un ejemplo de la vida real", "otro de la vida real", "¿por qué?",
  // MULETILLAS y CORTESÍA: lo que un alumno teclea de verdad entre ejercicio y ejercicio. No estaban
  // en el barrido, y por eso no se vio que "ok", "listo", "vale" y "perfecto" SALÍAN del motor
  // determinista con un tema del alcance activo (la IA llegaba a escribir en la pizarra la propia
  // frase del alumno). Van aquí para que esa clase entera quede vigilada en cada ejecución.
  "ok", "vale", "listo", "perfecto", "entendido", "siguiente", "dale", "gracias", "hola",
];
// PATRÓN REAL DEL CLIENTE: repite LA MISMA frase muchas veces seguidas. El barrido encadenaba frases
// DISTINTAS, y esa diferencia escondía una clase entera de defectos: con frases variadas la rotación
// parecía funcionar, y repitiendo una sola volvían los mismos dos ejemplos. Ahora se prueban las dos
// formas. (Los defectos que encontró el cliente en esta clase: "solo alterna dos ejemplos",
// "me muestra lo mismo a cada momento, como un bucle".)
const REPETIR = [
  "Por favor, muéstrame otro ejemplo.", "dame otro ejemplo", "y otro más",
  "Dame un ejemplo de la vida real.", "Por favor, dame un problema más difícil.", "quiero practicar",
];

const fallos = [];
let turnos = 0, sesiones = 0;
const anota = (conv, msg) => fallos.push({ conv: conv.join("  →  "), msg });

// `fraseFija` = patrón del cliente (la MISMA frase en cada turno). Sin ella, frases variadas.
async function conversar(tema, apertura, semilla, fraseFija = "") {
  let t = "", prev = "", hist = [], ej = null, resuelto = "", parte = "";
  const conv = [apertura];
  let ultimaFirma = "", ultimoResuelto = "", ultimasExpr = [];
  // Estado del navegador que el barrido debe replicar EXACTAMENTE, o no estará probando lo que se
  // entrega: el CURSOR de rotación (posición por tema:nivel, va y vuelve en cada consulta) y las
  // expresiones ya vistas, que el frontend antepone al resumen `previo`.
  const cursores = {}, vistas = [];
  const recordarVistas = (pasos) => {
    for (const d of pasos) {
      if (d.tipo !== "pizarra" || !d.contenido) continue;
      const c = String(d.contenido).trim();
      if (c.includes(":") || c.length > 24 || !/\d|x/i.test(c)) continue;
      if (!vistas.includes(c)) vistas.push(c);
      break;
    }
    while (vistas.length > 4) vistas.shift();
  };
  sesiones++;
  for (let k = 0; k <= TURNOS; k++) {
    const texto = k === 0 ? apertura : (fraseFija || SEGS[(semilla * 7 + k * 5) % SEGS.length]);
    if (k > 0) conv.push(texto);
    const F = FE(ej, resuelto);
    const seg = t ? F.clasificarSeguimiento(texto) : null;
    const body = { query: texto, modo: "ia" };
    if (t) body.currentTopic = t;
    if (hist.length) body.historial = hist.slice(-5);
    if (prev && t) body.previo = prev;
    if (Object.keys(cursores).length) body.cursores = cursores;
    if (seg) { body.contexto = t; body.seguimiento = seg; }
    if (seg === "reexplicar") { body.parte = parte || "resolucion"; if (resuelto && parte !== "concepto") body.ejercicio = resuelto; }
    if (seg === "desglosar" && ej) { body.ejercicio = ej.ejercicio; body.respuesta = ej.respuesta; }

    let j;
    try {
      const r = await fetch(BASE + "/api/query", { method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
      const txt = await r.text();
      try { j = JSON.parse(txt); } catch { anota(conv, `respuesta NO JSON (${txt.slice(0, 50)})`); return; }
    } catch (e) { anota(conv, `la petición falló: ${e.message}`); return; }
    turnos++;

    const pasos = j.pasos || [];
    const pizarras = pasos.filter((p) => p.tipo === "pizarra").map((p) => p.contenido);
    const dichos = pasos.filter((p) => p.tipo === "hablar").map((p) => p.texto);
    const preg = pasos.find((p) => p.tipo === "preguntar");
    const todo = [...dichos, ...pizarras, preg?.texto || ""].join(" ");

    // ══ INVARIANTES ══
    // I1. Un tema del alcance NUNCA debe depender de la IA.
    if (j.fuente_ia !== "local") anota(conv, `fuente=${j.fuente_ia} (el tema ${tema} debe ser determinista)`);
    // I2. La lección debe tener contenido.
    if (!pizarras.length) anota(conv, "lección SIN pizarra (pantalla vacía)");
    if (!dichos.length) anota(conv, "lección SIN explicación hablada");
    // I2b. La pizarra NUNCA debe limitarse a repetir lo que escribió el alumno. Es la forma visible de
    //      que la consulta se ha ido por un camino que no sabía qué hacer con ella: el alumno teclea
    //      "ok" y ve en la pizarra su propia frase anterior como si fuera la lección.
    if (pizarras.length === 1 && hist.length) {
      const p0 = String(pizarras[0]).trim().toLowerCase();
      if ([...hist, texto].some((h) => String(h).trim().toLowerCase() === p0))
        anota(conv, `la pizarra solo repite lo que escribió el alumno ("${pizarras[0]}")`);
    }
    // I3. La práctica calificable debe ser matemáticamente correcta.
    const pc = practicaOK(preg);
    if (pc === false) anota(conv, `PRÁCTICA MAL CALIFICADA: "${preg.texto}" → ${preg.respuesta}`);
    // I4. El enunciado de la práctica no puede ser un ejercicio ya RESUELTO en esta misma lección
    //     (le daría la respuesta hecha). Se compara con las pizarras ANTERIORES a la del enunciado,
    //     no con ella misma: en las lecciones de la vida real la última pizarra ES el enunciado.
    const nuevoResuelto = ejResuelto(pasos);
    if (preg && pizarras.length > 1) {
      const enunciado = (pizarras[pizarras.length - 1] || "").replace(/\s/g, "");
      const previas = pizarras.slice(0, -1).map((p) => p.replace(/\s/g, ""));
      if (enunciado && previas.includes(enunciado))
        anota(conv, `la práctica repite un ejercicio ya resuelto ("${pizarras[pizarras.length - 1]}")`);
    }
    // I5. Al pedir OTRO/DIFERENTE, la lección no puede ser idéntica a la anterior.
    const firma = pizarras.join("|");
    if (k > 0 && /otro|otra|diferente|distint|m[aá]s ejemplos/i.test(texto) && firma && firma === ultimaFirma)
      anota(conv, "pidió OTRO y devolvió la MISMA lección");
    // I6. "No entendí" no debe cambiar de problema.
    if (k > 0 && /no (lo )?entend/i.test(texto) && ultimoResuelto && nuevoResuelto) {
      const a = ultimoResuelto.replace(/\s/g, ""), b = nuevoResuelto.replace(/\s/g, "");
      if (!(a === b || b.includes(a) || a.includes(b)) && parte !== "concepto")
        anota(conv, `"no entendí" CAMBIÓ de problema: "${ultimoResuelto}" → "${nuevoResuelto}"`);
    }
    // I7. Pedir un EJEMPLO no debe entregar una tanda de práctica.
    if (k > 0 && /ejemplo/i.test(texto) && !/ejercicio|problema|practic/i.test(texto) && /¡A practicar!/.test(todo))
      anota(conv, "pidió un EJEMPLO y recibió EJERCICIOS de práctica");
    // I8. Pedir PRÁCTICA no debe resolvérsela.
    if (k > 0 && /quiero practicar|dame un ejercicio/i.test(texto) && !/¡A practicar!/.test(todo) && preg && !String(preg.respuesta || "").trim())
      anota(conv, "pidió practicar y no recibió un ejercicio calificable");
    // I10. TODO ejercicio que se deja en la pizarra se califica. Si se escriben dos y solo se pregunta
    //      uno, el alumno resuelve el segundo y nadie le dice si está bien (queja del cliente:
    //      "me deja dos ejercicios, pero sólo me valida uno").
    const retos = pizarras.filter((c) => /^\s*Ejercicio \d/.test(String(c))).length;
    const preguntas = pasos.filter((p) => p.tipo === "preguntar");
    if (retos && preguntas.length !== retos)
      anota(conv, `deja ${retos} ejercicios y solo califica ${preguntas.length}`);
    if (retos && preguntas.some((p) => !String(p.respuesta || "").trim()))
      anota(conv, "un ejercicio de práctica quedó SIN respuesta con la que calificarlo");
    // I9. Al pedir OTRO, la lección no puede reutilizar el EJEMPLO trabajado ni el EJERCICIO de
    //     práctica de la anterior. Más estricta que I5 (que solo ve la lección ENTERA repetida):
    //     detecta "otro ejemplo pero la misma práctica" y el ejercicio practicado que reaparece como
    //     ejemplo — que es como el alumno vive la repetición.
    //     Se comparan SOLO esas dos expresiones, no todas las pizarras: los pasos intermedios y la
    //     solución coinciden de forma legítima entre ejercicios distintos ("3x + 2 = 14" y
    //     "2x - 1 = 7" acaban los dos en "x = 4"), y contarlos daba falsos positivos.
    let enunciadoPract = "";
    if (preg) { const qi = pasos.indexOf(preg);
      for (let i = qi - 1; i >= 0; i--) if (pasos[i].tipo === "pizarra" && pasos[i].contenido) { enunciadoPract = pasos[i].contenido; break; } }
    const expr = [nuevoResuelto, enunciadoPract].filter(Boolean).map((c) => String(c).replace(/\s/g, ""));
    if (k > 1 && /otro|otra|diferente|distint|m[aá]s ejemplos/i.test(texto)) {
      const rep = expr.filter((c) => ultimasExpr.includes(c));
      if (rep.length) anota(conv, `pidió OTRO y repite el ejemplo/ejercicio anterior (${rep.join(", ")})`);
    }
    ultimasExpr = expr;

    if (j.cursores && typeof j.cursores === "object") Object.assign(cursores, j.cursores);
    hist.push(texto);
    if (!seg && !F.esSaludoOMeta(texto) && (F.tieneTemaExplicito(texto) || !t)) t = texto;
    recordarVistas(pasos);
    prev = vistas.join(" · ") + " · " + resumen(pasos);
    if (preg) { const qi = pasos.indexOf(preg); let b = "";
      for (let i = qi - 1; i >= 0; i--) if (pasos[i].tipo === "pizarra" && pasos[i].contenido) { b = pasos[i].contenido; break; }
      if (b || preg.texto) ej = { ejercicio: (b || preg.texto).trim(), respuesta: preg.respuesta || "" }; }
    if (nuevoResuelto) { ultimoResuelto = nuevoResuelto; resuelto = nuevoResuelto; }
    parte = MARCAS_CONCEPTO.test(todo) ? "concepto" : "resolucion";
    ultimaFirma = firma;
  }
}

console.log(`Barrido: ${OPEN.length} aperturas × (${SECUENCIAS} secuencias variadas + ${REPETIR.length} frases repetidas) × ${TURNOS} turnos  →  ${BASE}\n`);
for (const [tema, apertura] of OPEN) {
  for (let s = 0; s < SECUENCIAS; s++) await conversar(tema, apertura, s);
  for (const frase of REPETIR) await conversar(tema, apertura, 0, frase);
  process.stdout.write(`  ${tema.padEnd(15)} ${apertura.slice(0, 30).padEnd(32)} ok\n`);
}

console.log(`\n${"═".repeat(78)}`);
console.log(`Sesiones: ${sesiones} · Turnos: ${turnos} · Violaciones: ${fallos.length}`);
const agrupado = new Map();
for (const f of fallos) { const k = f.msg.replace(/"[^"]*"/g, '"…"'); if (!agrupado.has(k)) agrupado.set(k, []); agrupado.get(k).push(f); }
for (const [tipo, lista] of [...agrupado.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n✗ ${tipo}   (${lista.length} veces)`);
  for (const f of lista.slice(0, 2)) console.log(`    conversación: ${f.conv}\n    detalle: ${f.msg}`);
}
process.exit(fallos.length === 0 ? 0 : 1);
