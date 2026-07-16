// Math IA — lógica del frontend (Fases 1 + 2).
// Fase 1: entrada texto/voz, llamada al backend (clasificador → IA/LSG → PRE Light),
//         render del LSG como pasos + vista JSON + historial.
// Fase 2: escenario con avatar 2D, voz TTS en español y PSE Light reproduciendo
//         el LSG sincronizado (avatar ↔ pizarra ↔ revelación) con ramificación ligera.

import { Avatar } from "./avatar.js";
import { TTS } from "./tts.js";
import { PSELight, flattenLSG } from "./pseLight.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  input: $("#queryInput"),
  sendBtn: $("#sendBtn"),
  micBtn: $("#micBtn"),
  voiceStatus: $("#voiceStatus"),
  pipeline: $("#pipeline"),
  pillIntent: $("#pillIntent"),
  pillSource: $("#pillSource"),
  pillDuration: $("#pillDuration"),
  demoNotice: $("#demoNotice"),
  empty: $("#empty"),
  steps: $("#steps"),
  jsonView: $("#jsonView"),
  toggleJson: $("#toggleJson"),
  warnings: $("#warnings"),
  history: $("#history"),
  clearHistory: $("#clearHistory"),
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  // Fase 2 — escenario
  stage: $("#stage"),
  modeDemoBtn: $("#modeDemoBtn"),
  modeIaBtn: $("#modeIaBtn"),
  avatarMount: $("#avatar"),
  board: $("#board"),
  caption: $("#caption"),
  moduleTag: null,
  playBtn: $("#playBtn"),
  pauseBtn: $("#pauseBtn"),
  stopBtn: $("#stopBtn"),
  scrubber: $("#scrubber"),
  seekBar: $("#seekBar"),
  seekLabel: $("#seekLabel"),
  ttsInfo: $("#ttsInfo"),
  answerBox: $("#answerBox"),
  answerInput: $("#answerInput"),
  answerBtn: $("#answerBtn"),
  feedback: $("#feedback"),
};

const history = []; // { query, intencion, fuente, lsg, pasos, ts }
let currentLSG = null; // último LSG generado, para reproducir en el escenario
let seeking = false;   // true mientras el usuario arrastra la barra de pasos
let lastTopicQuery = null; // último TEMA consultado (para reexplicar en un "no entendí")
const historial = [];      // consultas recientes del alumno (contexto de conversación para la IA)
let lastLessonSummary = ""; // resumen de la ÚLTIMA lección (memoria: para no repetir el mismo ejemplo)
let lastExercise = null;    // EJERCICIO en pantalla { ejercicio, respuesta } — para "explícame los pasos"

// Extrae el EJERCICIO de práctica de un LSG: el enunciado escrito en la pizarra (o, en su defecto,
// el texto de la pregunta) junto con su respuesta ya calculada. Sirve para RE-NARRARLO paso a paso
// cuando el alumno pide "explícame los pasos anteriores" (continuidad de artefacto). null si no hay.
function extraerEjercicio(lsg) {
  const flat = flattenLSG(lsg) || [];
  const qIdx = flat.findIndex((d) => d.tipo === "preguntar");
  if (qIdx === -1) return null;
  const q = flat[qIdx];
  let board = "";
  for (let i = qIdx - 1; i >= 0; i--) {
    if (flat[i].tipo === "pizarra" && flat[i].contenido) { board = flat[i].contenido; break; }
  }
  const ejercicio = (board || q.texto || "").trim();
  if (!ejercicio) return null;
  const respuesta = (q.respuesta && String(q.respuesta).trim()) || "";
  return { ejercicio, respuesta };
}

// Resumen breve de una lección (sus primeras explicaciones), para dárselo a la IA como "lo ya visto".
function resumenLeccion(lsg) {
  const flat = flattenLSG(lsg) || [];
  const textos = flat.filter((d) => d.tipo === "hablar").map((d) => d.texto).filter(Boolean);
  return textos.slice(0, 2).join(" ").slice(0, 400);
}
let modo = "ia"; // "ia" = temas avanzados con Gemini · "demo" = temas básicos sin IA (instantáneo)

// Selector de modo: Demostración (básico, sin IA) / IA (avanzado, Gemini).
function setModo(m, announce) {
  modo = m === "demo" ? "demo" : "ia";
  els.modeDemoBtn.classList.toggle("active", modo === "demo");
  els.modeIaBtn.classList.toggle("active", modo === "ia");
  if (announce) {
    toast(modo === "demo"
      ? "Modo demostración: temas básicos (sumar, restar, multiplicar, dividir, fracciones, ecuaciones), sin IA."
      : "Modo IA: cualquier tema con la inteligencia artificial (derivadas, trigonometría, etc.).");
  }
}
els.modeDemoBtn.addEventListener("click", () => setModo("demo", true));
els.modeIaBtn.addEventListener("click", () => setModo("ia", true));
setModo(modo, false); // estado inicial (sin aviso)

// ¿La consulta es un SEGUIMIENTO ("no entendí", "explícamelo otra vez", "más simple")?
// En ese caso reexplicamos el último tema, no la tratamos como un tema nuevo.
// TOLERANTE A ERRATAS ("no enetendí", "no entiedo") — los alumnos escriben con errores.
function esSeguimiento(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  // "No entendí / no lo entiendo / no comprendo" en CUALQUIER posición (frase clara de no-comprensión).
  if (/\bno\s+(lo\s+|le\s+|la\s+|me\s+|se\s+lo\s+)?(entend|entiend|comprend|capt|pill)/.test(n)) return true;
  const corta = n.split(/\s+/).length <= 5;
  // Consulta corta con "no" + raíz de entender/comprender (aunque venga con erratas).
  if (corta && /\bno\b/.test(n) && /(t[ie]nd|tiend|ent[a-z]{0,3}d|entiend|comprend|capt|pill)/.test(n)) return true;
  // Inglés: no-comprensión / pedir re-explicación ("I don't understand", "explain again", "for dummies").
  if (/\b(i\s+)?(don'?t|do not|didn'?t|did not|can'?t|cannot)\s+(understand|get|follow)\b|\bdidn'?t (understand|get)\b|explain\s+(it\s+|this\s+)?(again|differently|another way)|\bfor dummies\b|\bonce more\b|\bmake it (simpler|clearer)\b/.test(n)) return true;
  // Pedir que se lo expliquen OTRA VEZ / el paso anterior / de otra forma / más despacio / "para dummies"
  // (peticiones conversacionales que se refieren a la lección anterior, no a un tema nuevo).
  return /(paso anterior|paso previo|otra vez|de nuevo|nuevamente|mas simple|mas facil|mas despacio|mas lento|mas claro|de otra forma|para dummies|no me quedo claro|no lo pill|no lo capt|reexplic|repite|repetir|vuelve a explic|regresa al|explica(me|lo)?\s*(de nuevo|otra vez|mejor|mas|el paso|paso))/.test(n);
}

// ¿La consulta pide AJUSTAR EL NIVEL del MISMO tema ("algo más básico", "uno más fácil",
// "más difícil")? Devuelve "mas_facil" | "mas_dificil" | null. Se trata como seguimiento del
// tema activo (no como un tema nuevo): así "más básico" da una ecuación más fácil, no "sumar".
function ajusteNivel(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const palabras = n.split(/\s+/).length;
  const facil = /(basic|facil|simple|sencill|element)/;
  const dificil = /(dificil|avanzad|complej|complic|\breto\b|\bdur[oa])/;
  // "más fácil/básico/simple/…" o "más difícil/avanzado/…" explícito → ajuste de nivel.
  if (/\bmas\s/.test(n) && facil.test(n)) return "mas_facil";
  if (/\bmas\s/.test(n) && dificil.test(n)) return "mas_dificil";
  // Consulta CORTA que pide básico/fácil (o difícil) SIN nombrar un tema nuevo.
  if (palabras <= 5 && facil.test(n)) return "mas_facil";
  if (palabras <= 5 && dificil.test(n)) return "mas_dificil";
  // Inglés: "more basic/simple/easy", "easier", "simpler" → más fácil; "harder", "more difficult" → más difícil.
  if (/\b(more|too)\s+(basic|simple|easy|elementary)\b|\beasier\b|\bsimpler\b/.test(n)) return "mas_facil";
  if (/\b(more|too)\s+(hard|difficult|advanced|complex|challenging)\b|\bharder\b/.test(n)) return "mas_dificil";
  return null;
}

// ¿La consulta CONTINÚA la conversación sobre el tema activo? (pedir OTRO ejemplo / una ANALOGÍA
// distinta —"con perritos"—, o una pregunta conceptual que se refiere a lo anterior —"¿eso quiere
// decir…?", "¿qué relación tienen… con…?"—). En estos casos se mantiene el TEMA activo y se
// responde el mensaje dentro de ese tema, en vez de tratarlo como un tema nuevo.
function esContinuacion(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  // Pedir otro ejemplo / otra analogía / "enséñame con …" / "con/de manzanas, perritos, dinero…".
  // Nota: "enséñame con ejemplos de manzanas" entra por "(enseña|explica)…con"; "enséñame DERIVADAS
  // con ejemplos" NO (nombra un tema) → se trata como tema nuevo. "de <objeto>" cubre "ejemplos de
  // manzanas"; los temas matemáticos ("de fracciones") NO están en la lista de objetos, así que no
  // se confunden con analogías.
  if (/(otro|otra|distint[oa]|diferente)\s*(ejemplos?|analog|forma|manera)|con\s+(otro|un)\s+ejemplos?|ejemplos?\s+(distint|diferent|nuev)|que no sea\b|diferente a\b|(ense[nñ]a|expl[ií]ca)\w*\s+con\b|(con|de)\s+(perr|gat|manzan|pera|naranj|platano|banana|dinero|moneda|comida|dulce|pelot|caramel|fruta|deporte|futbol|carro|coche|juguete|animal|galleta|pizza|chocolate|flor|arbol|canica|globo)/.test(n)) return true;
  // Pregunta/afirmación que se refiere a lo ANTERIOR (deixis) o a los ejemplos ya vistos.
  if (/\beso\b|\besto\b|\besos\b|\bentonces\b|\bo sea\b|quiere decir|\bpor eso\b|los? ejemplos?\b|lo anterior|lo que (dij|mencion|explic|vimo)|qu[eé] relaci[oó]n/.test(n)) return true;
  // Inglés: analogía con un objeto ("with/using apples"), otro ejemplo, o pregunta conceptual (deixis).
  // "explain addition with examples" NO entra (nombra un tema): solo objetos concretos y "another example".
  if (/\b(with|using|use)\s+(an?\s+|the\s+)?(apple|orange|banana|pear|dog|puppy|cat|money|coin|ball|candy|fruit|food|car|toy|animal|cookie|pizza|star|flower)s?\b/.test(n)) return true;
  if (/\b(another|other|a different)\s+(example|analogy|way)\b|\bdifferent example\b/.test(n)) return true;
  if (/\bdoes that mean\b|\bthat means\b|\bwhat('?s| is) the (relation|relationship)\b|\bhow (is|does) (this|that|it) relate\b/.test(n)) return true;
  return null;
}

// ¿La consulta pide que le EXPLIQUEN LOS PASOS / EL PROCEDIMIENTO del ejercicio que ya está en
// pantalla? ("explícame los pasos anteriores", "paso a paso", "desglósalo", "cómo lo resolviste",
// "muéstrame el procedimiento"…). Es continuidad de ARTEFACTO: hay que re-narrar ESE ejercicio,
// NO dar uno nuevo. OJO: NO debe confundirse con pedir un tema nuevo ("explícame las derivadas"):
// por eso exige palabras de PROCEDIMIENTO (paso, desglos, procedimiento, cómo se resuelve…).
function pidePasos(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  // Español: "los pasos (anteriores)", "paso a paso", "desglosa/desglose", "el procedimiento/proceso",
  // "cómo lo/la resolviste/hiciste/sacaste", "cómo se resuelve/hace/calcula", "detállame".
  if (/paso a paso|pasos? (anterior|previo|de|del|para|que|de ese|de este|del ejercicio)|desglos|(muestra|ensena|explica|detalla|dame)\w*\s*(me)?\s*(los?\s*)?(paso|procedimiento|proceso)|el procedimiento|el proceso de resol|como (lo|la|se)\s*(resolv|resuelv|hall|calcul|hiciste|hizo|saca|obtuv|obtien)|como se (resuelve|hace|calcula|obtiene)/.test(n)) return true;
  // Inglés: "step by step", "the (previous) steps", "break it down", "walk me through",
  // "how did you solve/get", "show me the steps", "explain the procedure/process".
  if (/step[\s-]*by[\s-]*step|the (previous )?steps|break (it|this|that) down|walk me through|how (did|do) you (solve|get|do)|how (is|was) (it|this|that) (solved|done)|(show|explain).*(steps|procedure|process)/.test(n)) return true;
  return false;
}

// ¿La consulta pide OTRO EJERCICIO para practicar (del MISMO tema)? ("dame otro ejercicio",
// "déjame uno diferente", "más ejercicios", "otro problema", en ES/EN). Es un seguimiento de
// PRÁCTICA: se mantiene el tema activo y se pide a la IA un ejercicio NUEVO del mismo tema —
// así "otro ejercicio diferente" sobre derivadas NO se convierte en ecuaciones lineales.
// OJO: si nombra un tema nuevo ("dame un ejercicio de fracciones"), NO es seguimiento (lo maneja
// el clasificador como tema nuevo); por eso se exige que NO haya tema explícito.
function pideOtroEjercicio(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (tieneTemaExplicito(q)) return false; // nombra un tema → tema nuevo, no seguimiento
  const es = /(otro|otra|nuev[oa]|distint[oa]|diferente|mas|un|una)\s+(ejercicio|ejercicios|problema|problemas|practica|reto)|(ejercicio|problema)\s+(diferente|distint[oa]|nuev[oa]|mas dificil|mas facil)|(dame|dejame|deja|ponme|pon|quiero|otro|otra|mas)\s+(ejercicio|ejercicios|problema|problemas|practica|practicar|uno|reto)|mas ejercicios|otro ejercicio|otro problema|dejame otro|dame otro/;
  const en = /(another|other|different|new|one more|a new)\s+(exercise|problem|question|one|practice)|(give|show).*(another|other|different)\s+(exercise|problem|one)|more (exercises|problems|practice)/;
  return es.test(n) || en.test(n);
}

// Clasifica el tipo de SEGUIMIENTO del tema activo (o null si es un tema nuevo).
function clasificarSeguimiento(q) {
  // "Explícame los pasos" del ejercicio actual → desglosar ESE ejercicio (solo si hay uno guardado).
  // Se comprueba PRIMERO: si no, la palabra "ejercicio(s)" haría que el clasificador lo tomara como
  // "practicar" y generara ejercicios NUEVOS (el defecto reportado). Sin ejercicio guardado, se
  // trata como "reexplicar" (re-enseñar el tema).
  if (pidePasos(q)) return lastExercise ? "desglosar" : "reexplicar";
  const aj = ajusteNivel(q);            // "mas_facil" | "mas_dificil"
  if (aj) return aj;
  if (esSeguimiento(q)) return "reexplicar"; // "no entendí", "otra vez", "de otra forma"…
  if (pideOtroEjercicio(q)) return "practicar"; // otro ejercicio del MISMO tema (mantiene derivadas, etc.)
  if (esContinuacion(q)) return "continuacion"; // otro ejemplo / analogía / pregunta contextual
  return null;
}

// ¿La consulta NOMBRA un tema/ejercicio concreto (derivadas, fracciones, una ecuación…)? Se usa
// para NO sobrescribir el tema activo con peticiones genéricas sin tema ("dame un ejercicio"),
// que antes borraban "derivadas" y hacían que la IA "bajara" a ecuaciones lineales por defecto.
function tieneTemaExplicito(q) {
  const n = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const temas = /(derivad|integral|deriva\b|ecuacion|inecuacion|fraccion|decimal|porcentaje|por ciento|\bsuma|sumar|\bresta|restar|multiplic|divi(de|di|si)|\bpotencia|\braiz|\barea|perimetro|volumen|geometr|trigonometr|\bseno|coseno|tangente|algebra|factoriz|diferencia de cuadrados|polinomi|logaritm|limite|matriz|probabilidad|estadistic|promedio|numero primo|maximo comun|minimo comun|regla de tres|proporcion|angulo|triangulo|circulo|cuadrado|rectangulo|derivative|integral|equation|fraction|percent|algebra|geometry|trigonometry)/;
  const expr = /\d\s*[-+*/^=]\s*[\w(]|\b[a-z]\s*=|[a-z]\s*[²³⁴⁵⁶⁷⁸⁹]|\bx\^/; // "2x+3", "x=", "x³", "x^2"
  return temas.test(n) || expr.test(q);
}

// --- Fase 2: avatar, voz y PSE Light ----------------------------------------
const avatar = new Avatar(els.avatarMount);
const tts = new TTS();
els.ttsInfo.textContent = tts.describe();
// Reintentar descripción cuando las voces carguen async.
setTimeout(() => (els.ttsInfo.textContent = tts.describe()), 800);

// Puente UI que el PSE Light usa para tocar el DOM.
const ui = {
  setModule(label) {
    const el = document.createElement("div");
    el.className = "board-module";
    el.textContent = `Módulo: ${label}`;
    els.board.appendChild(el);
    // Scroll SOLO dentro de la pizarra (no mover la página).
    els.board.scrollTop = els.board.scrollHeight;
  },
  writeBoard(text) {
    const line = document.createElement("div");
    line.className = "board-line reveal";
    line.textContent = text;
    els.board.appendChild(line);
    // Scroll SOLO dentro de la pizarra (no mover la página).
    els.board.scrollTop = els.board.scrollHeight;
    return line;
  },
  // Escribe la EXPLICACIÓN en la pizarra (no solo los números): el porqué de cada paso
  // queda escrito junto a la matemática, como en un cuaderno resuelto.
  writeBoardExplain(text) {
    const line = document.createElement("div");
    line.className = "board-explain reveal";
    line.textContent = text;
    els.board.appendChild(line);
    els.board.scrollTop = els.board.scrollHeight;
    return line;
  },
  highlightBoard(objetivo) {
    const lines = els.board.querySelectorAll(".board-line");
    lines.forEach((l) => l.classList.remove("hl"));
    let target = null;
    if (objetivo) {
      target = [...lines].reverse().find((l) => l.textContent.includes(objetivo));
    }
    (target || lines[lines.length - 1])?.classList.add("hl");
  },
  clearBoard() {
    els.board.innerHTML = "";
    els.feedback.hidden = true;
  },
  setCaption(text) {
    els.caption.textContent = text || "";
  },
  onStep(index) {
    els.steps.querySelectorAll(".step.active").forEach((s) => s.classList.remove("active"));
    if (index == null) return;
    const li = els.steps.querySelector(`.step[data-idx="${index}"]`);
    // Solo resaltar el paso activo; NO hacer scroll de la página (antes arrastraba
    // la vista al último paso del transcript mientras se reproducía).
    if (li) li.classList.add("active");
  },
  showFeedback(ok, msg) {
    els.feedback.hidden = false;
    els.feedback.className = "feedback " + (ok ? "ok" : "warn");
    els.feedback.textContent = msg;
  },
  // Estado de los controles: Reproducir / Pausar-Reanudar / Detener + barra.
  setControls({ playing, paused, hasLesson, total }) {
    els.playBtn.disabled = !hasLesson || (playing && !paused);
    els.playBtn.textContent = paused ? "▶ Reanudar" : "▶ Reproducir";
    els.pauseBtn.disabled = !playing || paused;
    els.stopBtn.disabled = !hasLesson || (!playing && !paused);
    els.scrubber.hidden = !hasLesson;
    if (total != null) els.seekBar.max = String(Math.max(0, total - 1));
    els.stage.classList.toggle("playing", !!playing);
  },
  // Avance de la barra de pasos durante la reproducción.
  onProgress(index, total) {
    els.seekBar.max = String(Math.max(0, (total || 0) - 1));
    if (!seeking) els.seekBar.value = String(index);
    els.seekLabel.textContent = `Paso ${Math.min(index + 1, total)} / ${total}`;
  },
  // Muestra la caja de respuesta y resuelve con lo que escriba el alumno.
  // Si se aborta (botón Detener), resuelve null y limpia sus listeners.
  askAnswer(questionText, opts = {}) {
    const { signal } = opts;
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve(null);
      // Mostrar SIEMPRE la pregunta/ejercicio junto a la caja para que no “desaparezca”
      // (sobre todo en el reintento, donde antes quedaba solo el mensaje "Casi…").
      if (questionText) els.caption.textContent = questionText;
      els.answerBox.hidden = false;
      els.answerInput.value = "";
      els.answerInput.focus();
      const cleanup = () => {
        els.answerBox.hidden = true;
        els.answerBtn.removeEventListener("click", onClick);
        els.answerInput.removeEventListener("keydown", onKey);
        signal?.removeEventListener("abort", onAbort);
      };
      const done = (val) => { cleanup(); resolve(val); };
      const onClick = () => done(els.answerInput.value.trim());
      const onKey = (e) => { if (e.key === "Enter") done(els.answerInput.value.trim()); };
      const onAbort = () => { cleanup(); resolve(null); };
      els.answerBtn.addEventListener("click", onClick);
      els.answerInput.addEventListener("keydown", onKey);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};

const pse = new PSELight({ avatar, tts, ui });

els.playBtn.addEventListener("click", () => {
  if (!currentLSG) return;
  // Si la lección ya está cargada (p.ej. tras pausar), reanuda desde el paso actual;
  // si es una lección nueva, la carga y reproduce desde el principio.
  if (pse.lsg === currentLSG) pse.play();
  else pse.play(currentLSG);
});
els.pauseBtn.addEventListener("click", () => pse.pause());
els.stopBtn.addEventListener("click", () => pse.stop());

// Barra de pasos (scrubber): retroceder/avanzar a cualquier punto.
els.seekBar.addEventListener("input", () => {
  seeking = true;
  const total = Number(els.seekBar.max) + 1;
  els.seekLabel.textContent = `Paso ${Number(els.seekBar.value) + 1} / ${total}`;
});
els.seekBar.addEventListener("change", () => {
  pse.seek(Number(els.seekBar.value));
  seeking = false;
});
// Clic en un paso del transcript también salta ahí (retroceder/avanzar).
els.steps.addEventListener("click", (e) => {
  const li = e.target.closest(".step[data-idx]");
  if (li) pse.seek(Number(li.dataset.idx));
});

// --- Estado del servicio -----------------------------------------------------
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.modo_ia === "gemini") {
      els.statusDot.className = "dot ok";
      els.statusText.textContent = `Gemini · ${data.modelo}`;
    } else {
      els.statusDot.className = "dot mock";
      els.statusText.textContent = "modo demo (sin API key)";
    }
  } catch {
    els.statusDot.className = "dot err";
    els.statusText.textContent = "sin conexión";
  }
}

// --- Envío de consulta -------------------------------------------------------
async function submitQuery() {
  const query = els.input.value.trim();
  if (!query) {
    toast("Escribe o dicta una consulta primero.");
    return;
  }

  // Seguimiento del tema activo: reexplicar ("no entendí"), ajustar nivel ("más básico/difícil")
  // o continuar la conversación (otro ejemplo, analogía, pregunta conceptual). En todos estos
  // casos NO es un tema nuevo: se mantiene el TEMA anterior (lastTopicQuery). Solo se considera
  // seguimiento si YA hay un tema activo.
  const tipoSeg = lastTopicQuery ? clasificarSeguimiento(query) : null; // p.ej. "continuacion"
  const seguimiento = !!tipoSeg;
  const body = { query, modo }; // modo: "demo" (básico) o "ia" (avanzado)
  // Contexto de conversación SIEMPRE (para que la IA nunca reciba la consulta AISLADA):
  //  - currentTopic: el tema activo · historial: las últimas consultas del alumno.
  // Así, aunque un seguimiento no se detecte con exactitud, la IA tiene el hilo y no "baja" de tema.
  if (lastTopicQuery) body.currentTopic = lastTopicQuery;
  if (historial.length) body.historial = historial.slice(-5);
  if (seguimiento) {
    body.contexto = lastTopicQuery;               // el TEMA activo, para no perderlo
    body.seguimiento = tipoSeg;                    // reexplicar | mas_facil | mas_dificil | continuacion | desglosar
    if (lastLessonSummary) body.previo = lastLessonSummary; // memoria: qué se explicó, para no repetir
    // Desglose paso a paso: enviamos el EJERCICIO actual + su respuesta para re-narrarlo (no crear uno nuevo).
    if (tipoSeg === "desglosar" && lastExercise) {
      body.ejercicio = lastExercise.ejercicio;
      body.respuesta = lastExercise.respuesta;
    }
  }
  // Registrar la consulta en el historial de la conversación (para el contexto de la IA).
  historial.push(query);
  if (historial.length > 12) historial.shift();

  setLoading(true);
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detalle || data.error || `Error ${res.status}`);
    }

    // Recordar el último TEMA real. SOLO se actualiza si la consulta NOMBRA un tema/ejercicio
    // concreto (o no había tema aún): así una petición genérica ("dame otro ejercicio") NO borra
    // "derivadas" y la IA no "baja" a ecuaciones lineales por defecto en la siguiente práctica.
    if (!seguimiento && (tieneTemaExplicito(query) || !lastTopicQuery)) lastTopicQuery = query;
    // Memoria de la lección recién generada (para que un próximo "otro ejemplo" no la repita).
    lastLessonSummary = resumenLeccion(data.lsg);
    // Recordar el EJERCICIO en pantalla (para "explícame los pasos"). Solo se actualiza si la
    // lección trae uno; un desglose (que no lo trae) conserva el ejercicio anterior.
    const ejActual = extraerEjercicio(data.lsg);
    if (ejActual) lastExercise = ejActual;

    renderResult(data);
    addToHistory(data);
    // Fase 2: llevar la vista al escenario y REPRODUCIR la lección automáticamente,
    // para que el avatar explique de inmediato sin que el usuario tenga que buscar
    // el botón "Reproducir" (era la principal confusión reportada).
    els.stage.scrollIntoView({ behavior: "smooth", block: "start" });
    pse.play(currentLSG);
  } catch (err) {
    toast(`No se pudo generar la lección: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  els.sendBtn.disabled = loading;
  els.sendBtn.textContent = loading ? "Generando…" : "Enviar";
}

// --- Render del LSG procesado ------------------------------------------------
function renderResult(data) {
  els.empty.hidden = true;
  els.pipeline.hidden = false;
  els.pillIntent.textContent = `Intención: ${data.intencion} (${Math.round(data.confianza * 100)}%)`;
  const esGemini = data.fuente_ia === "gemini";
  // "local" = desglose paso a paso calculado por el PRE Light (determinista, sin IA y sin coste):
  // NO es un fallo de Gemini, así que NO se muestra el aviso de modo demostración.
  const esLocal = data.fuente_ia === "local";
  els.pillSource.textContent = esLocal ? "Paso a paso (PRE Light)" : `IA: ${esGemini ? "Gemini" : "Modo demostración"}`;
  els.pillSource.classList.toggle("demo", !esGemini && !esLocal);
  els.pillDuration.textContent = `Duración: ~${data.lsg.duracion_estimada}s`;

  // MANEJO TRANSPARENTE DE ERRORES: si la lección NO vino de Gemini (y no es un desglose local),
  // avisamos con claridad que es contenido de MODO DEMOSTRACIÓN, sin presentarlo como respuesta
  // normal de la IA. Distinguimos si el alumno eligió el modo demostración o si Gemini falló.
  if (!esGemini && !esLocal) {
    const porFallo = modo !== "demo"; // el usuario quería IA pero Gemini no respondió
    const motivo = data.modelo === "limite-temporal"
      ? "Gemini alcanzó su límite de uso por el momento (cuota/uso por minuto)."
      : "Gemini no está disponible ahora (conexión o respuesta no válida).";
    els.demoNotice.innerHTML = porFallo
      ? `⚠️ <strong>Modo demostración.</strong> ${motivo} Esta lección es contenido de respaldo (temas básicos), <strong>no</strong> una respuesta generada por la IA. Vuelve a intentarlo en unos momentos para usar Gemini.`
      : `🎮 <strong>Modo demostración</strong> (elegido por ti): contenido local de temas básicos, sin usar la IA.`;
    els.demoNotice.classList.toggle("error", porFallo);
    els.demoNotice.hidden = false;
  } else {
    els.demoNotice.hidden = true;
  }

  els.steps.innerHTML = "";

  // Se recorre la MISMA línea de tiempo que reproduce el PSE Light, para que el
  // índice de cada paso coincida y se pueda resaltar el paso activo (data-idx).
  const timeline = flattenLSG(data.lsg);
  timeline.forEach((d, idx) => {
    if (d.tipo === "modulo") {
      const label = document.createElement("li");
      label.className = "module-label";
      label.textContent = `Módulo: ${d.id}`;
      els.steps.appendChild(label);
    } else {
      const li = renderStep(d);
      li.dataset.idx = String(idx);
      els.steps.appendChild(li);
    }
  });

  // Guardar el LSG para reproducirlo en el escenario (Fase 2).
  currentLSG = data.lsg;
  els.playBtn.disabled = false;

  // Vista JSON
  els.jsonView.textContent = JSON.stringify(data.lsg, null, 2);

  // Advertencias del PRE Light
  if (Array.isArray(data.advertencias) && data.advertencias.length) {
    els.warnings.hidden = false;
    els.warnings.innerHTML =
      "<strong>Avisos del PRE Light:</strong><ul>" +
      data.advertencias.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
      "</ul>";
  } else {
    els.warnings.hidden = true;
  }
}

function renderStep(d) {
  const li = document.createElement("li");
  li.className = `step tipo-${d.tipo}`;

  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = d.tipo;

  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = describeDirectiva(d);

  li.append(tag, body);
  return li;
}

// Convierte una directiva en una descripción legible para el alumno/revisor.
function describeDirectiva(d) {
  switch (d.tipo) {
    case "avatar":
      return `El avatar hace: <em>${escapeHtml(d.accion)}</em>`;
    case "hablar":
      return `🗣️ “${escapeHtml(d.texto)}”`;
    case "esperar":
      return `⏸️ Pausa de ${escapeHtml(String(d.segundos))} s`;
    case "pizarra":
      return `📝 Pizarra (${escapeHtml(d.accion)}): <span class="mono">${escapeHtml(d.contenido)}</span>`;
    case "puntero":
      return `👉 Resalta${d.objetivo ? `: <span class="mono">${escapeHtml(d.objetivo)}</span>` : ""}`;
    case "preguntar":
      return `❓ <strong>${escapeHtml(d.texto)}</strong>` +
        `<div class="branch">✔ correcto → ${escapeHtml(d.si_correcto)} · ` +
        `✘ incorrecto → ${escapeHtml(d.si_incorrecto)}</div>`;
    default:
      return escapeHtml(JSON.stringify(d));
  }
}

// --- Historial ---------------------------------------------------------------
function addToHistory(data) {
  const entry = { ...data, ts: new Date() };
  history.unshift(entry);
  renderHistory();
}

function renderHistory() {
  els.history.innerHTML = "";
  if (!history.length) {
    els.history.innerHTML = '<li style="cursor:default;color:var(--muted)">Sin interacciones aún.</li>';
    return;
  }
  history.forEach((h, i) => {
    const li = document.createElement("li");
    const time = h.ts.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    li.innerHTML =
      `<span class="h-intent">${escapeHtml(h.intencion)}</span>` +
      `<span class="h-query">${escapeHtml(h.query)}</span>` +
      `<span class="h-time">${time}</span>`;
    li.addEventListener("click", () => renderResult(h));
    els.history.appendChild(li);
  });
}

// --- Entrada por voz (Web Speech API) ---------------------------------------
let recognition = null;
let listening = false;

function initSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    els.micBtn.disabled = true;
    els.micBtn.title = "Tu navegador no soporta reconocimiento de voz";
    els.voiceStatus.textContent = "🎤 El reconocimiento de voz no está disponible en este navegador (usa Chrome/Edge).";
    return;
  }

  recognition = new SR();
  recognition.lang = "es-ES";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    listening = true;
    els.micBtn.classList.add("listening");
    els.voiceStatus.textContent = "🎤 Escuchando… habla tu consulta.";
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    els.input.value = transcript;
  };

  recognition.onerror = (event) => {
    // Manejo básico de errores de reconocimiento para no romper la experiencia.
    const messages = {
      "no-speech": "No se detectó voz. Intenta de nuevo.",
      "audio-capture": "No se encontró micrófono.",
      "not-allowed": "Permiso de micrófono denegado.",
      "network": "Error de red en el reconocimiento de voz.",
    };
    els.voiceStatus.textContent = "⚠️ " + (messages[event.error] || `Error de voz: ${event.error}`);
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
    if (els.input.value.trim()) {
      els.voiceStatus.textContent = "✔️ Consulta reconocida. Revisa y envía.";
    }
  };
}

function toggleListening() {
  if (!recognition) return;
  if (listening) {
    recognition.stop();
  } else {
    try {
      els.voiceStatus.textContent = "";
      recognition.start();
    } catch {
      // start() puede lanzar si ya está activo; lo ignoramos.
    }
  }
}

function stopListening() {
  listening = false;
  els.micBtn.classList.remove("listening");
}

// --- Utilidades --------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

// --- Eventos -----------------------------------------------------------------
els.sendBtn.addEventListener("click", submitQuery);
els.micBtn.addEventListener("click", toggleListening);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitQuery();
});
els.toggleJson.addEventListener("click", () => {
  const hidden = els.jsonView.hidden;
  els.jsonView.hidden = !hidden;
  els.toggleJson.textContent = hidden ? "Ocultar LSG (JSON)" : "Ver LSG (JSON)";
});
els.clearHistory.addEventListener("click", () => {
  // Limpieza COMPLETA de la sesión: borra el historial visible Y el contexto que se envía a Gemini
  // (tema activo + últimas consultas). Tras esto, la siguiente consulta empieza como sesión NUEVA.
  history.length = 0;
  lastTopicQuery = null;   // olvida el TEMA activo (no se seguirá enviando como contexto)
  historial.length = 0;    // olvida el historial de conversación que se manda a la IA
  lastLessonSummary = "";  // olvida la memoria de la última lección
  lastExercise = null;     // olvida el ejercicio en pantalla (para "explícame los pasos")
  renderHistory();
  toast("Sesión reiniciada: se borró el historial, el tema activo y el contexto. La próxima consulta empieza de cero.");
});
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    els.input.value = chip.dataset.example;
    els.input.focus();
  });
});

// --- Init --------------------------------------------------------------------
checkHealth();
initSpeech();
renderHistory();
