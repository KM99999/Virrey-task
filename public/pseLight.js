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
    // Guiones/menos unicode ("−" U+2212, "–", "—", "‐"…) → "-" ASCII: si el alumno escribe una respuesta
    // NEGATIVA con el "signo menos" real ("−4"), Number("−4") es NaN y se calificaba MAL una respuesta
    // correcta. Misma clase de bug que rompía el parseo del solver.
    .replace(/[‐-―−⁃﹘﹣－]/g, "-")
    .replace(/­/g, "")
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

// ¿La respuesta es un MONOMIO algebraico ("3x²", "2x", "x", "3x^2")? Para estos, la comparación
// numérica NO sirve (3x y 3x² empiezan por "3" pero son distintos): hay que comparar la forma
// simbólica completa. Se usa en respuestas de derivadas y similares.
const SUP_A_NUM = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
function esMonomio(s) {
  return /^[+-]?\d*\.?\d*[a-z](?:\^?\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹])?$/.test(s);
}
function normSym(s) {
  let r = String(s).toLowerCase().replace(/\s+/g, "").replace(/[*·]/g, "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUP_A_NUM[c]).replace(/\^/g, "");
  r = r.replace(/([a-z])1$/, "$1");          // exponente 1 implícito: "2x1" (2x¹) → "2x"
  r = r.replace(/^([+-]?)1([a-z])/, "$1$2");  // coeficiente 1 implícito: "1x" → "x"
  return r;
}
// Forma CANÓNICA de un polinomio en x ("12x³ - 12x + 9" ↔ "9 - 12x + 12x^3"): suma coeficientes por
// exponente y ordena por exponente descendente. Devuelve null si no es un polinomio limpio en x (así
// las respuestas con unidades/fracciones siguen por la comparación numérica). Acepta "x^n", "xⁿ" y "xn".
function polyCanon(s) {
  let t = String(s).toLowerCase().replace(/\s+/g, "").replace(/[*·]/g, "")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => "^" + SUP_A_NUM[c]);   // x² → x^2
  t = t.replace(/x\^?(\d+)/g, "x^$1").replace(/x(?![\^0-9])/g, "x^1"); // x → x^1, x3 → x^3
  if (!/x/.test(t)) return null;
  const terms = t.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  const map = new Map();
  for (const term of terms) {
    const sign = term[0] === "-" ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    let m = body.match(/^(\d*\.?\d*)x\^(-?\d+)$/);
    if (m) { const coef = sign * (m[1] === "" ? 1 : Number(m[1])); map.set(+m[2], (map.get(+m[2]) || 0) + coef); continue; }
    m = body.match(/^(\d+\.?\d*)$/);
    if (m) { map.set(0, (map.get(0) || 0) + sign * Number(m[1])); continue; }
    return null; // término no reconocido → no es polinomio limpio
  }
  const ord = [...map.entries()].filter(([, c]) => c !== 0).sort((a, b) => b[0] - a[0]);
  return ord.length ? ord.map(([e, c]) => `${c}x^${e}`).join("+") : "0";
}
// Forma CANÓNICA de una FACTORIZACIÓN "c(x - a)(x + b)…": coeficiente líder + conjunto ORDENADO de
// binomios (x±k). Acepta reordenar los factores y variantes de signo/espacio. Devuelve null si no
// parece una factorización (producto de binomios), para no interferir con otras comparaciones.
function factorCanon(s) {
  const t = String(s).toLowerCase().replace(/\s+/g, "").replace(/[·*]/g, "");
  const bins = [...t.matchAll(/\(([+-]?\d*)([a-z])([+-]\d+)\)/g)];
  if (!bins.length) return null;
  const cm = t.match(/^([+-]?\d+)\(/);                 // coeficiente líder antes del primer "("
  let coef = cm ? Number(cm[1]) : 1;
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
  const terms = [];
  for (const b of bins) {
    let a = b[1] === "" || b[1] === "+" ? 1 : b[1] === "-" ? -1 : Number(b[1]);
    const v = b[2];
    let k = Number(b[3]);
    // Saca el factor común del binomio para que (2x-4)(2x+4) == 4(x-2)(x+2): (2x-4) → 2(x-2).
    const g = gcd(a, k);
    a /= g; k /= g; coef *= g;
    terms.push(`${a}${v}${k >= 0 ? "+" : ""}${k}`);
  }
  terms.sort();
  return `${coef}|${terms.join(",")}`;
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
  // Respuesta ALGEBRAICA (monomio: "3x", "3x²"…): si CUALQUIERA de las dos es algebraica, se compara
  // SOLO la forma simbólica completa. Así no se validan falsos positivos por la comparación numérica,
  // que solo mira el número inicial: "3x" NO es "3", ni "2x" es "3x²".
  if (esMonomio(a) || esMonomio(b)) {
    return { known: true, correct: normSym(a) === normSym(b) };
  }
  // Respuesta FACTORIZADA ("(x - 3)(x + 3)"): comparar como PRODUCTO DE BINOMIOS (orden indistinto).
  // Va antes que el polinomio para que "(x-3)(x+3)" no se intente comparar como polinomio suelto.
  if (/\)\s*\(/.test(a) || /\)\s*\(/.test(b)) {
    const fa = factorCanon(a), fb = factorCanon(b);
    if (fa != null && fb != null) return { known: true, correct: fa === fb };
  }
  // Respuesta POLINÓMICA ("12x³ - 12x + 9"): comparar forma canónica (ordena términos, normaliza
  // exponentes) → acepta reordenar y "x^3"/"x³", y rechaza un polinomio incorrecto/incompleto.
  if (/[a-z]/.test(a) && /[a-z]/.test(b)) {
    const ca = polyCanon(a), cb = polyCanon(b);
    if (ca != null && cb != null) return { known: true, correct: ca === cb };
  }
  // Comparación por VALOR, aceptando fracciones equivalentes (1/2 == 3/6 == 0.5),
  // decimales y respuestas con unidades ("8" == "8 metros/segundo").
  let va = numFrom(a);
  const vb = numFrom(b);
  // El alumno suele responder con una FRASE ("la respuesta es 4", "x vale 4", "es 4") en vez de con el
  // número suelto. Si lo esperado es un NÚMERO y en su frase hay UN ÚNICO número, ese es su respuesta:
  // marcarla mal era un falso negativo (queja del cliente: "le doy la respuesta correcta y me dice que
  // no lo es"). Se exige UN SOLO número para no adivinar: con varios ("entre 3 y 5") no se interpreta.
  if (!Number.isFinite(va) && Number.isFinite(vb)) {
    const nums = String(a).match(/-?\d+(?:\.\d+)?(?:\/\d+)?/g);
    if (nums && nums.length === 1) va = fracVal(nums[0]);
  }
  if (Number.isFinite(va) && Number.isFinite(vb)) {
    if (Math.abs(va - vb) < 1e-9) return { known: true, correct: true };
    // El alumno pudo REDONDEAR una respuesta no entera (p.ej. 7/3 → "2.33" o "2.333"). Aceptamos SU decimal
    // si es el redondeo CORRECTO del valor exacto a la cantidad de decimales que escribió, y el esperado NO es
    // entero. Así no se marca MAL una respuesta bien redondeada (falso negativo, la queja nº1 del cliente),
    // sin aflojar la calificación de enteros ni aceptar decimales genuinamente incorrectos ("2.4" para 7/3).
    const dm = a.match(/\.(\d+)/);
    const dec = dm ? dm[1].length : 0;
    if (dec > 0 && !Number.isInteger(vb)) {
      const p = Math.pow(10, dec);
      const rounded = Math.round(vb * p) / p;
      if (Math.abs(va - rounded) < 1e-9) return { known: true, correct: true };
    }
    return { known: true, correct: false };
  }
  // Tolerancia de texto para respuestas cortas: una contiene a la otra (p.ej. alumno "sumar 7" vs
  // esperado "sumar 7 a ambos lados"). PERO el match no puede PARTIR un número: "restar 3" no debe
  // aceptarse dentro de "restar 30" (daba un falso positivo al quitar los espacios).
  const contiene = (x, y) => {
    const i = x.indexOf(y);
    if (i === -1) return false;
    if (/\d/.test(y[y.length - 1]) && /\d/.test(x[i + y.length] || "")) return false; // corta un número por la derecha
    if (/\d/.test(y[0]) && /\d/.test(x[i - 1] || "")) return false;                    // …o por la izquierda
    return true;
  };
  if (a.length >= 3 && b.length >= 3 && (contiene(a, b) || contiene(b, a))) {
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
    // Cómo va el alumno en ESTA lección: si contestó a un ejercicio calificable y si acertó. Sirve
    // para encadenar la siguiente parte de la clase (seguir, subir de nivel o reforzar).
    this._respondio = false;
    this._acerto = false;
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

  // Retroceder/avanzar: salta EXACTAMENTE al paso `i` que indica el usuario y se queda ahí, en pausa.
  // Antes se auto-reanudaba la reproducción, y la barra "se escapaba" hacia adelante (al punto donde
  // iba la app, no al que el usuario soltó). Ahora queda en el punto indicado; el usuario pulsa
  // Reanudar para continuar DESDE ahí.
  seek(i) {
    if (!this.timeline.length) return;
    if (this._abort) this._abort.abort();
    this.tts.cancel();
    this.avatar.setSpeaking(false);
    this.index = Math.max(0, Math.min(Math.round(i), this.timeline.length - 1));
    this.playing = false;
    this.paused = true;
    this._rebuildBoardTo(this.index);
    this.ui.onProgress?.(this.index, this.timeline.length);
    this.ui.setCaption("⏸ En pausa — pulsa Reanudar para continuar desde aquí.");
    this._notifyControls();
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
        // LA CLASE CONTINÚA. Antes la lección terminaba aquí y se acababa todo: el alumno resolvía un
        // ejercicio y el tutor se callaba (queja del cliente: "enseña un tema, enseña un ejercicio y
        // culmina la clase. La clase debe continuar"). Ahora se avisa a la interfaz de CÓMO terminó
        // —si hubo ejercicio calificable y si lo acertó— para que enlace la siguiente parte de la clase.
        this.ui.onLessonEnd?.({ respondio: this._respondio, acerto: this._acerto });
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

    // Sin verdad-base → NO se juzga correcto/incorrecto. OJO: si la pregunta es COMPUTACIONAL (pide un
    // resultado concreto: "¿cuál es la derivada…?", "¿cuánto es…?") y no pudimos calcular la verdad
    // (p.ej. derivada de un producto/trig, fuera de la regla de la potencia), NO se elogia la respuesta
    // —eso daría por buena una respuesta ERRADA—: se da un mensaje NEUTRAL que remite a la pizarra.
    // El "¡Muy bien!" se reserva para preguntas de COMPRENSIÓN reales ("¿entendiste?").
    if (!expected) {
      const negativa = /^(no|nop|nel|para nada|no s[eé])\b/i.test(answer.trim());
      // Solo elogiamos ("¡Perfecto!") en preguntas de COMPRENSIÓN/opinión ("¿entendiste?", "¿quedó claro?",
      // "¿te gustaría…?"), donde no hay respuesta verdadera/falsa. En CUALQUIER otra pregunta sin verdad-base
      // deducible —una FACTUAL como "¿es 10 un número primo?" que la IA no resolvió— NO confirmamos la
      // respuesta (diríamos "¡Muy bien!" a una respuesta ERRÓNEA): mensaje NEUTRAL que remite a la pizarra.
      const esComprension = /entend|qued[oó]\s+claro|te\s+gustar[ií]a|te\s+gusta|de\s+acuerdo|list[oa]\b|continu|seguim|repas/i.test(d.texto || "");
      const msg = negativa
        ? "Sin problema. Puedes volver a reproducir la lección para repasarla con calma. 👍"
        : esComprension
          ? "¡Perfecto! Sigamos. 👍"
          : "Gracias por tu respuesta. Compárala con lo explicado en la pizarra para verificarla. 👀";
      this.ui.showFeedback(true, msg);
      await this._speak(msg, "sonriendo", signal);
      return;
    }

    // El resultado se anota por PREGUNTA, no de forma acumulada. En la práctica hay DOS ejercicios: si
    // solo se marcara el acierto, bastaría con acertar el primero para que la clase subiera de nivel
    // aunque el segundo se hubiera fallado. Cuenta cómo le fue en el ÚLTIMO que respondió.
    this._respondio = true;
    this._acerto = false;
    if (checkAnswer(answer, expected).correct) {
      this._acerto = true;
      // El elogio VARÍA. Repetir siempre la misma frase es lo que hacía que el tutor pareciera un
      // robot (queja del cliente). `_frase` recorre la lista sin repetir hasta agotarla.
      const msg = d.si_correcto === "felicitar"
        ? this._frase("bien", ["¡Muy bien! 🎉 Respuesta correcta.", "¡Exacto! 🎉 Así se hace.",
            "¡Correcto! 🎉 Lo has resuelto bien.", "¡Perfecto! 🎉 Ese es el resultado.",
            "¡Muy bien! 🎉 Has aplicado el método correctamente."])
        : this._frase("sigue", ["¡Correcto! Continuemos.", "Bien, sigamos.", "Exacto. Vamos con lo siguiente.", "Correcto, seguimos."]);
      this.ui.showFeedback(true, msg);
      await this._speak(msg, "sonriendo", signal);
      return;
    }

    // RAMIFICACIÓN LIGERA ante un error: en vez de repetir el mismo ejercicio a secas o revelar la
    // respuesta, damos una PISTA (cada vez más concreta) del MÉTODO y permitimos REINTENTAR. La caja
    // de respuesta NO desaparece: se reabre de inmediato y la voz suena en paralelo.
    const boardText = this._exerciseBoard(timeline, index);
    const acerto = async (msg) => { this._acerto = true; this.ui.showFeedback(true, msg); await this._speak(msg, "sonriendo", signal); };

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

  // Elige una frase de `lista` DISTINTA de las últimas usadas para esa clave. El tutor decía siempre
  // exactamente las mismas palabras y el alumno lo notaba ("da la apariencia de un robot"): la
  // matemática debe ser idéntica siempre, pero el lenguaje no tiene por qué serlo.
  _frase(clave, lista) {
    this._frasesUsadas ||= {};
    const i = ((this._frasesUsadas[clave] ?? -1) + 1) % lista.length;
    this._frasesUsadas[clave] = i;
    return lista[i];
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
  // TEMAS QUE EL MOTOR NO GARANTIZA (integrales, límites, sistemas, matrices, logaritmos,
  // trigonometría…): aquí NO se inventa un método. Antes caían en la rama de aritmética y el alumno
  // recibía, ante una integral, la pista "recuerda el orden: primero × y ÷, luego + y −" —
  // instrucciones que no tienen nada que ver con lo que se le pregunta (queja del cliente: "las
  // indicaciones no son claras", con la captura de una integral). Se le remite a lo explicado en la
  // pizarra, que es lo único que aquí podemos asegurar que corresponde a su ejercicio.
  if (/∫|integral|l[ií]mite|\blim\b|sistema de ecuaciones|matri[cz]|logaritm|\blog\b|\bln\b|derivada parcial|trigonom|\bseno\b|\bcoseno\b|\btangente\b/.test(t)) {
    return nivel >= 2
      ? "Repasa en la pizarra el método que acabamos de aplicar en el ejemplo y sigue los mismos pasos con tu ejercicio."
      : "Pista: vuelve al ejemplo resuelto de la pizarra y aplica el mismo procedimiento paso a paso.";
  }
  // SUSTITUIR en una derivada YA calculada ("la derivada es 2q, ¿cuánto vale con q = 5?"). NO es
  // derivar: es evaluar. Va ANTES de la rama de derivadas porque el enunciado contiene la palabra
  // "derivada" y se llevaba la pista de la regla de la potencia — el alumno pedía ayuda para
  // sustituir un número y se le respondía "baja el exponente y réstale una unidad". Incoherente, y
  // reportado por el cliente: "pide derivar, y a la vez brinda un número 5".
  if (/sustitu/.test(t) || /la derivada (ya |)?(est[aá] calculada|es)\s*[^,.]*[,.]?\s*(¿|sustituyendo|cu[aá]nto vale)/.test(t)) {
    return nivel >= 2
      ? "La derivada ya está hecha: donde aparece la letra, escribe el número que te dan y resuelve esa multiplicación."
      : "Pista: no hay que derivar otra vez. Sustituye el valor en la expresión de la derivada y calcula.";
  }
  // Derivadas (regla de la potencia): guiar con el MÉTODO, sin dar el resultado.
  if (/derivad|deriva|d\/dx/.test(t)) {
    return nivel >= 2
      ? "Regla de la potencia: el exponente baja a multiplicar delante y, en su sitio, queda una unidad menos."
      : "Pista: para derivar una potencia, baja el exponente a multiplicar delante y réstale una unidad.";
  }
  // Factorización / diferencia de cuadrados: guiar con el método correcto (NO con "despejar la letra",
  // que es de ecuaciones lineales). Se detecta por la palabra o por el producto de binomios "(…)(…)".
  if (/factoriz|diferencia de cuadrados|binomi/.test(t) || /\)\s*\(/.test(t)) {
    return nivel >= 2
      ? "Diferencia de cuadrados: a² - b² = (a - b)(a + b). Halla 'a' (la raíz del primer término) y 'b' (la raíz del segundo) y escribe (a - b)(a + b)."
      : "Pista: mira si es una diferencia de cuadrados (algo al cuadrado menos algo al cuadrado) y aplica (a - b)(a + b).";
  }
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
  // Ecuación LINEAL (variable aislada junto a un número/operador y un "="): guiar con la operación
  // inversa. Se excluyen potencias y productos de binomios (factorización/cuadráticas), que no se despejan así.
  if (b.includes("=") && !/[²³⁴⁵⁶⁷⁸⁹]|\^|\)\s*\(/.test(b) && /\d[a-z]|\b[a-z]\s*[-+=]|=\s*[a-z]\b/.test(b)) {
    return nivel >= 2
      ? "Para despejar la letra, primero pasa el número que la acompaña al otro lado con la operación inversa (si suma, resta; si resta, suma) y luego divide por el coeficiente."
      : "Pista: usa la operación inversa en ambos lados para dejar la letra sola.";
  }
  // Aritmética con un operador. Solo si de verdad es ARITMÉTICA: números y un signo, sin letras de
  // por medio. Sin esta condición, cualquier ejercicio con un "+" o un "*" —una integral, por
  // ejemplo— se llevaba la pista del orden de las operaciones, que no le sirve de nada.
  if (/\d\s*[×÷*+]\s*\d|\d\s*\/\s*\d|\d\s*-\s*\d/.test(t) && !/[a-z]\s*[²³⁴⁵⁶⁷⁸⁹^]|\bx\b|\bd[xyzt]\b/.test(t)) {
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
