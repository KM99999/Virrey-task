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
  // Comparación numérica tolerante (p.ej. "5" vs "5.0", "x=5" vs "5").
  const na = Number(a.replace(/^[a-z]+=/, ""));
  const nb = Number(b.replace(/^[a-z]+=/, ""));
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return { known: true, correct: Math.abs(na - nb) < 1e-9 };
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
      else if (d.tipo === "pizarra") this.ui.writeBoard(d.contenido);
      else if (d.tipo === "puntero") this.ui.highlightBoard(d.objetivo || null);
    }
    this.ui.onStep(i < this.timeline.length ? i : null);
  }

  async _speak(text, state, signal) {
    this.avatar.setState(state);
    this.avatar.setSpeaking(true);
    this.ui.setCaption(text);
    await this.tts.speak(text, { signal });
    this.avatar.setSpeaking(false);
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
        ? "Sin problema, repasémoslo con calma. ¡Sigamos!"
        : "¡Bien! Gracias por participar. Sigamos avanzando.";
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

    // Incorrecto → un reintento (ramificación ligera).
    this.ui.showFeedback(false, "Casi. Piénsalo un momento e inténtalo otra vez.");
    await this._speak("Casi. Piénsalo un momento e inténtalo otra vez.", "hablando", signal);
    if (signal.aborted) return;

    const retry = await this.ui.askAnswer("Inténtalo otra vez: " + d.texto, { signal });
    if (signal.aborted || retry == null) return;

    if (checkAnswer(retry, expected).correct) {
      this.ui.showFeedback(true, "¡Eso es! Ahora sí. 🎉");
      await this._speak("¡Eso es! Ahora sí lo tienes.", "sonriendo", signal);
    } else {
      this.ui.showFeedback(false, `La respuesta correcta es: ${expected}. ¡Sigue practicando!`);
      await this._speak(`La respuesta correcta es ${expected}. ¡Sigue practicando, vas bien!`, "hablando", signal);
    }
  }
}

function mapAvatarAction(accion) {
  const a = String(accion || "").toLowerCase();
  if (a.includes("sonr")) return "sonriendo";
  if (a.includes("pens")) return "pensando";
  if (a.includes("pregunt")) return "preguntando";
  return "neutral";
}
