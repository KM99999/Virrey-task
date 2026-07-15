// PSE Light — Motor de Sincronización Pedagógica (Fase 2).
//
// Reproduce un LSG (ya validado por el PRE Light) como una línea de tiempo:
// ejecuta cada directiva EN ORDEN, sincronizando la voz del avatar (TTS) con la
// revelación progresiva del contenido en la pizarra y las acciones del avatar.
// En las directivas "preguntar" aplica RAMIFICACIÓN LIGERA: evalúa la respuesta
// del alumno y decide continuar / felicitar / mostrar otro ejemplo (un reintento).
//
// Se separan funciones PURAS (flatten/evaluación, testables sin navegador) de la
// clase PSELight, que orquesta avatar + TTS + DOM.

// --- Funciones puras (unit-testables en Node) --------------------------------

// Aplana el LSG a una lista ordenada de eventos. En LSG modular inserta un
// marcador { tipo:"modulo", id } antes de las directivas de cada módulo.
export function flattenLSG(lsg) {
  const timeline = [];
  if (!lsg || typeof lsg !== "object") return timeline;

  if (Array.isArray(lsg.modulos)) {
    for (const mod of lsg.modulos) {
      timeline.push({ tipo: "modulo", id: mod.id });
      for (const d of mod.directivas || []) timeline.push(d);
    }
  } else if (Array.isArray(lsg.directivas)) {
    for (const d of lsg.directivas) timeline.push(d);
  }
  return timeline;
}

// Intenta deducir la respuesta esperada mirando lo último escrito en la pizarra
// con forma "algo = valor" ANTES de una directiva "preguntar" dada.
// Solo acepta un valor NUMÉRICO simple (p.ej. "x = 5" → "5", "y = -3/2" → "-3/2");
// para contenidos como "d/dx[xⁿ] = n·xⁿ⁻¹" devuelve null y el PSE usa autoevaluación
// (Sí/No), evitando marcar como incorrecta una respuesta conceptual válida.
export function extractExpectedAnswer(timeline, questionIndex) {
  let expected = null;
  for (let i = 0; i < questionIndex; i++) {
    const d = timeline[i];
    if (d?.tipo === "pizarra" && typeof d.contenido === "string" && d.contenido.includes("=")) {
      const parts = d.contenido.split("=");
      const lhs = parts[0].trim();
      const rhs = parts.slice(1).join("=").trim();
      // Solo la FORMA RESUELTA: una variable sola = número (p.ej. "x = 5", "y = -3/2").
      // NO tomar el "7" de un ejemplo como "x + 3 = 7" (cuya solución es 4, no 7).
      if (/^[a-zA-Z]$/.test(lhs) && /^[-+]?\d+([.,/]\d+)?$/.test(rhs)) expected = rhs;
    }
  }
  return expected;
}

// Normaliza una respuesta para comparar (minúsculas, sin espacios, sin puntos
// finales, comas → puntos para decimales).
export function normalizeAnswer(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[.]+$/, "")
    .trim();
}

// Valor numérico de una respuesta, aceptando fracciones ("1/2" → 0.5) y decimales.
function fracVal(s) {
  const m = String(s).match(/^(-?\d+)\/(-?\d+)$/);
  if (m) { const d = Number(m[2]); return d !== 0 ? Number(m[1]) / d : NaN; }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Valor numérico incluso si viene con unidades al final: "8metros/segundo" → 8,
// "1/2litros" → 0.5. Solo extrae el número si está AL INICIO (evita capturar un
// número suelto dentro de una frase conceptual como "sumar7aambos" → NO).
function numFrom(s) {
  const str = String(s).replace(/^[a-z]+=/, "");
  const direct = fracVal(str);
  if (Number.isFinite(direct)) return direct;
  const m = str.match(/^-?\d+\/\d+|^-?\d+(?:\.\d+)?/);
  return m ? fracVal(m[0]) : NaN;
}

// Evalúa la respuesta del alumno contra la esperada.
// Devuelve { known:boolean, correct:boolean }. Si no hay respuesta esperada
// deducible, known=false (el PSE hará autoevaluación Sí/No).
export function checkAnswer(student, expected) {
  if (expected == null || String(expected).trim() === "") {
    return { known: false, correct: false };
  }
  const a = normalizeAnswer(student);
  const b = normalizeAnswer(expected);
  if (!a) return { known: true, correct: false };
  if (a === b) return { known: true, correct: true };
  // Comparación por VALOR, aceptando fracciones equivalentes (1/2 == 3/6 == 0.5),
  // decimales y respuestas con unidades ("8" == "8 metros/segundo").
  const va = numFrom(a);
  const vb = numFrom(b);
  if (Number.isFinite(va) && Number.isFinite(vb)) {
    return { known: true, correct: Math.abs(va - vb) < 1e-9 };
  }
  // Tolerancia de texto para respuestas cortas: una contiene a la otra
  // (p.ej. alumno "sumar 7" vs esperado "sumar 7 a ambos lados").
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    return { known: true, correct: true };
  }
  return { known: true, correct: false };
}

// --- Reproductor (navegador) -------------------------------------------------

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

export class PSELight {
  /**
   * @param {object} deps
   * @param {import('./avatar.js').Avatar} deps.avatar
   * @param {import('./tts.js').TTS} deps.tts
   * @param {object} deps.ui - callbacks hacia el DOM (ver app.js):
   *    setModule(label), writeBoard(text)->el, highlightBoard(objetivo),
   *    clearBoard(), setCaption(text), onStep(index|null),
   *    askAnswer(questionText)->Promise<string>, showFeedback(ok, msg),
   *    setPlaying(bool)
   */
  constructor({ avatar, tts, ui }) {
    this.avatar = avatar;
    this.tts = tts;
    this.ui = ui;
    this._abort = null;
    this.lsg = null;
    this.timeline = [];
    this.index = 0;
    this.playing = false;
    this.paused = false;
    this._speakToken = 0; // evita que una locución vieja apague la animación de una nueva
  }

  _notifyControls() {
    this.ui.setControls?.({
      playing: this.playing,
      paused: this.paused,
      hasLesson: this.timeline.length > 0,
      index: this.index,
      total: this.timeline.length,
    });
  }

  // Carga una lección nueva (resetea el reproductor al paso 0).
  load(lsg) {
    this._hardReset();
    this.lsg = lsg;
    this.timeline = flattenLSG(lsg);
    this.index = 0;
    this.ui.clearBoard();
    this.ui.setCaption("");
    this.ui.onProgress?.(0, this.timeline.length);
    this._notifyControls();
  }

  _hardReset() {
    if (this._abort) this._abort.abort();
    this.tts.cancel();
    this.playing = false;
    this.paused = false;
    this.avatar.setSpeaking(false);
  }

  stop() {
    this._hardReset();
    this.index = 0;
    this.avatar.setState("neutral");
    this.ui.onStep(null);
    this.ui.clearBoard();
    this.ui.setCaption("");
    this.ui.onProgress?.(0, this.timeline.length);
    this._notifyControls();
  }

  // Pausa sin reiniciar: se puede reanudar desde donde iba.
  pause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    if (this._abort) this._abort.abort();
    this.tts.cancel();
    this.avatar.setSpeaking(false);
    this.ui.setCaption("⏸ En pausa — pulsa Reanudar para continuar.");
    this._notifyControls();
  }

  // Retroceder/avanzar: salta al paso `i` y reconstruye la pizarra hasta ahí.
  seek(i) {
    if (!this.timeline.length) return;
    const wasActive = this.playing && !this.paused;
    if (this._abort) this._abort.abort();
    this.tts.cancel();
    this.avatar.setSpeaking(false);
    this.index = Math.max(0, Math.min(Math.round(i), this.timeline.length - 1));
    this.playing = false;
    this.paused = true;
    this._rebuildBoardTo(this.index);
    this.ui.onProgress?.(this.index, this.timeline.length);
    this._notifyControls();
    if (wasActive) this.play(); // si estaba reproduciendo, continúa desde el nuevo punto
  }

  // Reproduce/reanuda desde el paso actual. Con `lsg`, carga una lección nueva.
  async play(lsg) {
    if (lsg) this.load(lsg);
    if (!this.timeline.length) return;
    if (this.index >= this.timeline.length) this.index = 0; // terminó → reiniciar
    if (this.playing && !this.paused) return;               // ya está reproduciendo

    const controller = new AbortController();
    this._abort = controller;
    const signal = controller.signal;
    this.playing = true;
    this.paused = false;
    this._notifyControls();

    this._rebuildBoardTo(this.index); // deja la pizarra coherente con el punto actual

    try {
      while (this.index < this.timeline.length && this.playing && !this.paused && !signal.aborted) {
        await this._runDirective(this.timeline[this.index], this.index, this.timeline, signal);
        if (signal.aborted || this.paused || !this.playing) break;
        this.index++;
        this.ui.onProgress?.(this.index, this.timeline.length);
      }
      if (this.index >= this.timeline.length && !signal.aborted && !this.paused) {
        this.avatar.setState("sonriendo");
        this.ui.setCaption("¡Lección completada! 🎉");
        this.playing = false;
        this.ui.onStep(null);
        this._notifyControls();
      }
    } finally {
      this.avatar.setSpeaking(false);
      if (this._abort === controller) this._abort = null;
    }
  }

  // Reconstruye la pizarra reproduciendo (instantáneo, sin voz ni pausas) los efectos
  // visuales de los pasos 0..i-1. Permite retroceder/reanudar sin duplicar contenido.
  _rebuildBoardTo(i) {
    this.ui.clearBoard();
    for (let k = 0; k < i; k++) {
      const d = this.timeline[k];
      if (!d) continue;
      if (d.tipo === "modulo") this.ui.setModule(d.id);
      else if (d.tipo === "hablar") this.ui.writeBoardExplain?.(d.texto);
      else if (d.tipo === "pizarra") this.ui.writeBoard(d.contenido);
      else if (d.tipo === "puntero") this.ui.highlightBoard(d.objetivo || null);
    }
    this.ui.onStep(i < this.timeline.length ? i : null);
  }

  async _speak(text, state, signal) {
    const token = ++this._speakToken;
    this.avatar.setState(state);
    this.avatar.setSpeaking(true);
    this.ui.setCaption(text);
    await this.tts.speak(text, { signal });
    // Solo apagar la animación si NADIE empezó a hablar después (evita cortar la
    // animación de una locución nueva cuando una vieja termina tarde).
    if (token === this._speakToken) this.avatar.setSpeaking(false);
  }

  async _runDirective(d, index, timeline, signal) {
    if (d.tipo !== "modulo") this.ui.onStep(index);

    switch (d.tipo) {
      case "modulo":
        this.ui.setModule(d.id);
        await sleep(400, signal);
        break;

      case "avatar":
        this.avatar.setState(mapAvatarAction(d.accion));
        await sleep(500, signal);
        break;

      case "hablar":
        // La explicación se ESCRIBE en la pizarra (no solo se narra), para que el
        // tablero muestre el razonamiento del ejercicio, no únicamente los números.
        this.ui.writeBoardExplain?.(d.texto);
        await this._speak(d.texto, "hablando", signal);
        break;

      case "esperar": {
        const secs = Math.min(4, Math.max(1, Number(d.segundos) || 2));
        this.avatar.setState("pensando");
        await sleep(secs * 1000, signal);
        break;
      }

      case "pizarra": {
        this.ui.writeBoard(d.contenido);
        await sleep(700, signal);
        break;
      }

      case "puntero":
        this.ui.highlightBoard(d.objetivo || null);
        await sleep(700, signal);
        break;

      case "preguntar":
        await this._handleQuestion(d, index, timeline, signal);
        break;

      default:
        break;
    }
  }

  // Ramificación ligera: pregunta, evalúa y decide (un reintento).
  async _handleQuestion(d, index, timeline, signal) {
    await this._speak(d.texto, "preguntando", signal);
    if (signal.aborted) return;

    // Verdad-base para calificar: la respuesta que dio la IA (d.respuesta) o, en su
    // defecto, la forma resuelta escrita en la pizarra. Si no hay ninguna, la pregunta
    // es solo de comprensión y NUNCA se marca como incorrecta.
    const expected = (d.respuesta && d.respuesta.trim()) || extractExpectedAnswer(timeline, index);

    const answer = await this.ui.askAnswer(d.texto, { signal });
    if (signal.aborted || answer == null) return;

    // Sin verdad-base → verificación de comprensión (no se juzga correcto/incorrecto).
    if (!expected) {
      const negativa = /^(no|nop|nel|para nada|no s[eé])\b/i.test(answer.trim());
      const msg = negativa
        ? "Sin problema. Puedes volver a reproducir la lección para repasarla con calma. 👍"
        : "¡Muy bien! Gracias por participar. 👏";
      this.ui.showFeedback(true, msg);
      await this._speak(msg, "sonriendo", signal);
      return;
    }

    if (checkAnswer(answer, expected).correct) {
      const msg = d.si_correcto === "felicitar"
        ? "¡Muy bien! 🎉 Respuesta correcta."
        : "¡Correcto! Continuemos.";
      this.ui.showFeedback(true, msg);
      await this._speak(msg, "sonriendo", signal);
      return;
    }

    // RAMIFICACIÓN LIGERA ante un error: en vez de repetir el mismo ejercicio a secas o revelar la
    // respuesta, damos una PISTA (cada vez más concreta) del MÉTODO y permitimos REINTENTAR. La caja
    // de respuesta NO desaparece: se reabre de inmediato y la voz suena en paralelo.
    const boardText = this._exerciseBoard(timeline, index);
    const acerto = async (msg) => { this.ui.showFeedback(true, msg); await this._speak(msg, "sonriendo", signal); };

    // 1er error → mostrar OTRO EJEMPLO resuelto (si lo hay) o una pista; luego permitir REINTENTAR.
    if (d.otro_ejemplo) {
      this.ui.showFeedback(false, "Casi. Veamos otro ejemplo parecido, resuelto, y lo intentas de nuevo.");
      await this._showWorkedExample(d.otro_ejemplo, signal);
      if (signal.aborted) return;
      if (boardText) this.ui.writeBoard(boardText); // volver a mostrar TU ejercicio para el reintento
    } else {
      const hint = buildHint(d.texto, boardText, 1);
      this.ui.showFeedback(false, `Casi. ${hint} Inténtalo otra vez.`);
      this._speak(`Casi. ${hint}`, "hablando", signal); // no bloquea: la caja se reabre ya
    }
    let retry = await this.ui.askAnswer(d.texto, { signal });
    if (signal.aborted || retry == null) return;
    if (checkAnswer(retry, expected).correct) { await acerto("¡Eso es! Ahora sí. 🎉"); return; }

    // 2º error → pista más concreta del método + otro reintento.
    const hint2 = buildHint(d.texto, boardText, 2);
    this.ui.showFeedback(false, `Aún no, pero vas bien. ${hint2} Prueba una vez más.`);
    this._speak(`Aún no. ${hint2}`, "hablando", signal);
    retry = await this.ui.askAnswer(d.texto, { signal });
    if (signal.aborted || retry == null) return;
    if (checkAnswer(retry, expected).correct) { await acerto("¡Muy bien, lo lograste! 🎉"); return; }

    // Sigue sin acertar: NO revelamos el número. Recordamos el MÉTODO y animamos a repasar/reintentar.
    const cierre = `No te preocupes, así se aprende. ${buildHint(d.texto, boardText, 2)} Puedes volver a reproducir la lección para repasar el método y luego intentarlo de nuevo. ¡Tú puedes!`;
    this.ui.showFeedback(false, cierre);
    await this._speak(cierre, "hablando", signal);
  }

  // Muestra en la pizarra un EJEMPLO ALTERNATIVO resuelto paso a paso (narrado), para la ramificación.
  async _showWorkedExample(ej, signal) {
    if (!ej) return;
    if (ej.intro) { await this._speak(ej.intro, "hablando", signal); if (signal.aborted) return; }
    if (ej.original) { this.ui.writeBoard(ej.original); await sleep(700, signal); if (signal.aborted) return; }
    for (const paso of (ej.pasos || [])) {
      if (signal.aborted) return;
      if (paso.explica) { this.ui.writeBoardExplain?.(paso.explica); await this._speak(paso.explica, "hablando", signal); }
      if (signal.aborted) return;
      if (paso.escribe) { this.ui.writeBoard(paso.escribe); await sleep(700, signal); }
    }
    if (ej.cierre && !signal.aborted) await this._speak(ej.cierre, "sonriendo", signal);
  }

  // Devuelve el ejercicio escrito en la pizarra JUSTO antes de la pregunta (para dar pistas).
  _exerciseBoard(timeline, questionIndex) {
    for (let i = questionIndex - 1; i >= 0; i--) {
      if (timeline[i]?.tipo === "pizarra" && timeline[i].contenido) return timeline[i].contenido;
    }
    return "";
  }
}

// Genera una PISTA del método (sin revelar la respuesta), adaptada al tipo de ejercicio.
// `nivel` 1 = pista suave; 2 = pista más concreta (primer paso del método).
export function buildHint(question, board, nivel) {
  const t = `${question || ""} ${board || ""}`.toLowerCase();
  const b = (board || "").toLowerCase();
  // Problemas con FÓRMULA o enunciado verbal (velocidad, área, distancia/tiempo, %, potencia, promedio…).
  if (/velocidad|rapidez|distancia|tiempo|[aá]rea|per[ií]metro|volumen|por ciento|%|al cuadrado|al cubo|elevado|ra[ií]z|promedio|\bmedia\b/.test(t)) {
    return nivel >= 2
      ? "Identifica la fórmula u operación que relaciona los datos y calcúlala paso a paso con los números del enunciado."
      : "Pista: piensa qué fórmula u operación conecta los datos del ejercicio.";
  }
  // Fracciones.
  if (/\d+\s*\/\s*\d+/.test(t)) {
    return nivel >= 2
      ? "Con el mismo denominador, opera solo los numeradores y mantén el denominador; al final simplifica si puedes."
      : "Pista: fíjate primero en los denominadores antes de sumar o restar.";
  }
  // Ecuación (variable aislada junto a un número/operador y un "="): guiar con la operación inversa.
  if (b.includes("=") && /\d[a-z]|\b[a-z]\s*[-+=]|=\s*[a-z]\b/.test(b)) {
    return nivel >= 2
      ? "Para despejar la letra, primero pasa el número que la acompaña al otro lado con la operación inversa (si suma, resta; si resta, suma) y luego divide por el coeficiente."
      : "Pista: usa la operación inversa en ambos lados para dejar la letra sola.";
  }
  // Aritmética con un operador.
  if (/[×÷*+]|\d\s*\/\s*\d|\d\s*-\s*\d/.test(t)) {
    return nivel >= 2
      ? "Resuelve paso a paso: identifica la operación y calcúlala con calma; recuerda el orden (primero × y ÷, luego + y −)."
      : "Pista: mira con calma qué operación pide el ejercicio y hazla paso a paso.";
  }
  return nivel >= 2
    ? "Repasa el último paso escrito en la pizarra: ahí está el método para resolverlo."
    : "Pista: vuelve a fijarte en el método que usamos en el ejemplo de la pizarra.";
}

function mapAvatarAction(accion) {
  const a = String(accion || "").toLowerCase();
  if (a.includes("sonr")) return "sonriendo";
  if (a.includes("pens")) return "pensando";
  if (a.includes("pregunt")) return "preguntando";
  return "neutral";
}
