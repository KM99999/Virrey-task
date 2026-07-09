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
// Devuelve el lado derecho de la última ecuación, o null si no se puede deducir.
export function extractExpectedAnswer(timeline, questionIndex) {
  let expected = null;
  for (let i = 0; i < questionIndex; i++) {
    const d = timeline[i];
    if (d?.tipo === "pizarra" && typeof d.contenido === "string" && d.contenido.includes("=")) {
      const rhs = d.contenido.split("=").pop().trim();
      if (rhs) expected = rhs;
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
  if (expected == null) return { known: false, correct: false };
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
    this.playing = false;
  }

  stop() {
    if (this._abort) this._abort.abort();
    this.tts.cancel();
    this.playing = false;
    this.avatar.setSpeaking(false);
    this.avatar.setState("neutral");
    this.ui.onStep(null);
    this.ui.setPlaying(false);
  }

  async play(lsg) {
    this.stop();
    const controller = new AbortController();
    this._abort = controller;
    const signal = controller.signal;
    this.playing = true;
    this.ui.setPlaying(true);
    this.ui.clearBoard();
    this.ui.setCaption("");

    const timeline = flattenLSG(lsg);

    try {
      for (let i = 0; i < timeline.length; i++) {
        if (signal.aborted) break;
        await this._runDirective(timeline[i], i, timeline, signal);
      }
      if (!signal.aborted) {
        this.avatar.setState("sonriendo");
        this.ui.setCaption("¡Lección completada! 🎉");
      }
    } finally {
      this.avatar.setSpeaking(false);
      this.ui.onStep(null);
      this.playing = false;
      this.ui.setPlaying(false);
      this._abort = null;
    }
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

    const expected = extractExpectedAnswer(timeline, index);
    const answer = await this.ui.askAnswer(d.texto, expected != null);
    if (signal.aborted || answer == null) return;

    let { known, correct } = checkAnswer(answer, expected);
    // Sin respuesta deducible → autoevaluación: "si"/"no".
    if (!known) correct = /^s[ií]|correct|bien|entend/i.test(answer.trim());

    if (correct) {
      const msg = d.si_correcto === "felicitar"
        ? "¡Muy bien! 🎉 Respuesta correcta."
        : "¡Correcto! Continuemos.";
      this.ui.showFeedback(true, msg);
      await this._speak(msg, "sonriendo", signal);
      return;
    }

    // Incorrecto → un reintento con "otro ejemplo" / repaso.
    this.ui.showFeedback(false, "Casi. Veamos otro ejemplo y lo intentas de nuevo.");
    await this._speak("No pasa nada. Veamos otro ejemplo y lo intentas de nuevo.", "hablando", signal);
    if (signal.aborted) return;

    if (expected != null) {
      this.ui.writeBoard(`Pista: la respuesta es ${expected}`);
      await sleep(700, signal);
    }

    const retry = await this.ui.askAnswer("Inténtalo otra vez: " + d.texto, expected != null);
    if (signal.aborted || retry == null) return;

    let r = checkAnswer(retry, expected);
    let ok = r.known ? r.correct : /^s[ií]|correct|bien|entend/i.test(retry.trim());
    if (ok) {
      this.ui.showFeedback(true, "¡Eso es! Ahora sí. 🎉");
      await this._speak("¡Eso es! Ahora sí lo tienes.", "sonriendo", signal);
    } else {
      this.ui.showFeedback(false, `La respuesta era ${expected ?? "la mostrada"}. ¡Sigue practicando!`);
      await this._speak("La respuesta correcta era esa. ¡Sigue practicando, vas bien!", "hablando", signal);
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
