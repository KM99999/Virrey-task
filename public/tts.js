// TTS — síntesis de voz en español (Fase 2).
// Envuelve la Web Speech API (SpeechSynthesis) y expone speak() como Promise que
// se resuelve cuando termina de hablar, para que el PSE Light pueda sincronizar
// la revelación del contenido con la voz del avatar.
//
// Si el navegador no tiene voz en español (o no soporta TTS), speak() cae en un
// retardo estimado por longitud del texto, para que la sincronización siga
// funcionando (el avatar "habla" con subtítulos aunque no haya audio).

// ─── Normalización para la VOZ (no para la pantalla) ─────────────────────────
// Los motores de voz del navegador leen mal las letras de variables y los símbolos
// matemáticos sueltos: "x" suena "ecs" (no "equis"), "n" suena "en" (no "ene"),
// la "y" variable suena "i" (como la conjunción). Esta capa convierte SOLO el texto
// que se HABLA (la pizarra y los subtítulos siguen mostrando "x", "=", "x²").
const NOMBRE_LETRA = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "hache",
  i: "i", j: "jota", k: "ka", l: "ele", m: "eme", n: "ene", "ñ": "eñe", o: "o",
  p: "pe", q: "cu", r: "erre", s: "ese", t: "te", u: "u", v: "uve",
  w: "doble uve", x: "equis", y: "ye", z: "zeta",
};
const ORD_SUPER = { "⁴": "cuarta", "⁵": "quinta", "⁶": "sexta", "⁷": "séptima", "⁸": "octava", "⁹": "novena" };

export function normalizeForSpeech(text) {
  if (typeof text !== "string" || !text) return text;
  let s = " " + text + " ";

  // 1) Exponentes (superíndices) sobre letra/número → palabras.
  s = s.replace(/([0-9a-zñ)])\s*²/gi, "$1 al cuadrado")
       .replace(/([0-9a-zñ)])\s*³/gi, "$1 al cubo")
       .replace(/([0-9a-zñ)])\s*ⁿ/gi, "$1 a la ene")
       .replace(/([0-9a-zñ)])\s*([⁴⁵⁶⁷⁸⁹])/gi, (_, b, e) => `${b} a la ${ORD_SUPER[e]}`);

  // 1b) Exponente con ACENTO CIRCUNFLEJO "^" (el motor decía "circunflejo"): "x^2" → "al cuadrado",
  //     "x^3" → "al cubo", "x^n" → "elevado a la n". Cubre también "^" suelto.
  s = s.replace(/\s*\^\s*2\b/g, " al cuadrado")
       .replace(/\s*\^\s*3\b/g, " al cubo")
       .replace(/\s*\^\s*(\d+)/g, " elevado a la $1")
       .replace(/\s*\^\s*([a-zñ])/gi, (_, l) => ` elevado a la ${NOMBRE_LETRA[l.toLowerCase()] || l}`)
       .replace(/\^/g, " elevado a la ");

  // 1c) Cálculo: diferencial "dx/dy/dz/dt" (el motor decía "dec") → "de equis/ye/zeta/te";
  //     e integral "∫" → "integral de".
  s = s.replace(/∫/g, " integral de ")
       .replace(/\bd\s*([xyzt])\b/gi, (_, l) => `de ${NOMBRE_LETRA[l.toLowerCase()]}`);

  // 2) Símbolos matemáticos → palabras.
  s = s.replace(/\s*=\s*/g, " igual a ")
       .replace(/\s*[×·]\s*/g, " por ")
       .replace(/\s*÷\s*/g, " entre ")
       .replace(/√\s*/g, " raíz de ")
       .replace(/\s*≈\s*/g, " aproximadamente ")
       .replace(/\s*≠\s*/g, " distinto de ")
       .replace(/\s*≤\s*/g, " menor o igual que ")
       .replace(/\s*≥\s*/g, " mayor o igual que ")
       .replace(/\s*±\s*/g, " más menos ")
       .replace(/(\d)\s*%/g, "$1 por ciento")
       .replace(/π/g, " pi ");

  // 3) Operadores + - * / en contexto matemático (evita tocar guiones de palabras:
  //    el "-" solo se convierte si hay un dígito en algún lado; "auto-evaluación" queda intacto).
  s = s.replace(/([0-9a-zñ)])\s*\*\s*([0-9a-zñ(])/gi, "$1 por $2")
       .replace(/([0-9a-zñ)])\s*\/\s*([0-9a-zñ(])/gi, "$1 entre $2")
       .replace(/([0-9a-zñ)])\s*\+\s*([0-9a-zñ(])/gi, "$1 más $2")
       .replace(/(\d)\s*[-−]\s*([0-9a-zñ(])/gi, "$1 menos $2")
       .replace(/([0-9a-zñ)])\s*[-−]\s*(\d)/gi, "$1 menos $2");

  // 4) Coeficiente pegado a variable: "3x" → "3 equis", "2y" → "2 ye".
  s = s.replace(/(\d)([a-zñ])(?![a-zñ])/gi, (_, d, l) => `${d} ${NOMBRE_LETRA[l.toLowerCase()] || l}`);

  // 5) "y" como VARIABLE (no la conjunción "y"=«y»): solo junto a contexto matemático.
  s = s.replace(/\by\s+igual a/gi, "ye igual a")
       .replace(/igual a\s+y\b/gi, "igual a ye")
       .replace(/\b(despej\w*|variable|inc[oó]gnita|valor de|t[eé]rmino)\s+y\b/gi, "$1 ye");

  // 6) Letras de variable AISLADAS → su nombre. Solo consonantes (+w): las vocales a/e/i/o/u
  //    ya se pronuncian igual como letra o como palabra, así que no hace falta tocarlas, y así
  //    "manzanas y peras" o "5 y 3" conservan la "y"/vocales de la lengua natural.
  s = s.replace(/(^|[^a-zñáéíóúü])([b-df-hj-np-tvwxz])(?=$|[^a-zñáéíóúü])/gi,
        (_, pre, l) => pre + (NOMBRE_LETRA[l.toLowerCase()] || l));

  // 7) Paréntesis → pausa (el motor los lee raro); limpiar espacios.
  s = s.replace(/[()]/g, " ").replace(/\s{2,}/g, " ").trim();
  return s;
}

// Trocea el texto en FRASES CORTAS (≤ ~130 caracteres) para que ninguna locución sea larga y el
// navegador no la corte a mitad. Divide por signos de puntuación fuertes y, si una frase es enorme,
// por comas o espacios. Devuelve siempre al menos un trozo.
export function chunkForSpeech(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const piezas = s.match(/[^.!?;:]+[.!?;:]*/g) || [s];
  const out = [];
  const push = (x) => { const t = x.trim(); if (t) out.push(t); };
  let buf = "";
  for (const p of piezas) {
    if ((buf + p).length > 130 && buf) { push(buf); buf = ""; }
    buf += p;
    while (buf.length > 180) {
      let cut = buf.lastIndexOf(",", 170);
      if (cut < 60) cut = buf.lastIndexOf(" ", 170);
      if (cut < 60) cut = 170;
      push(buf.slice(0, cut)); buf = buf.slice(cut);
    }
  }
  push(buf);
  return out.length ? out : [s];
}

export class TTS {
  constructor() {
    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    this.enabled = !!this.synth;
    this.voice = null;
    this.rate = 0.95; // un poco más pausado: se entiende mejor y suena menos entrecortado
    this.pitch = 1.0;
    this._pickVoice();
    // Las voces cargan async en algunos navegadores.
    if (this.synth && "onvoiceschanged" in this.synth) {
      this.synth.onvoiceschanged = () => this._pickVoice();
    }
  }

  _pickVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices() || [];
    this.voice =
      voices.find((v) => /^es[-_]ES/i.test(v.lang)) ||
      voices.find((v) => /^es[-_]MX/i.test(v.lang)) ||
      voices.find((v) => /^es/i.test(v.lang)) ||
      null;
  }

  hasSpanishVoice() {
    return !!this.voice;
  }

  // Describe el estado para la UI (audio real vs. subtítulos temporizados).
  describe() {
    if (!this.enabled) return "sin TTS (subtítulos)";
    if (!this.voice) return "voz del sistema (sin es-ES)";
    return `voz: ${this.voice.name}`;
  }

  /**
   * Habla el texto. Devuelve una Promise que resuelve al terminar.
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]
   */
  speak(text, opts = {}) {
    const { signal } = opts;
    // Lo que se DICE se normaliza (variables y símbolos → palabras); la pantalla/subtítulos
    // muestran el texto ORIGINAL (esto no los toca: solo afecta a la locución).
    const spoken = normalizeForSpeech(text);
    if (!spoken || signal?.aborted) return Promise.resolve();

    // Sin voz real: retardo proporcional (subtítulos temporizados).
    if (!this.enabled || !this.voice) {
      return new Promise((resolve) => {
        const ms = Math.min(22000, Math.max(1200, spoken.length * 60));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }

    // Los motores del navegador CORTAN las locuciones largas (~15 s), dejando palabras a medias y
    // "saltándose" texto (no se entiende la explicación). Solución: hablar FRASE POR FRASE (trozos
    // cortos), en secuencia, con un "keepalive" (pause+resume) que evita que Chrome detenga la voz.
    const chunks = chunkForSpeech(spoken);
    return new Promise((resolve) => {
      let aborted = false;
      signal?.addEventListener("abort", () => { aborted = true; try { this.synth.cancel(); } catch {} }, { once: true });
      const speakNext = (i) => {
        if (aborted || i >= chunks.length) return resolve();
        this._speakOne(chunks[i], () => aborted).then(() => speakNext(i + 1));
      };
      speakNext(0);
    });
  }

  // Habla UN trozo corto. Resuelve al terminar (o al abortar). Keepalive contra el corte de Chrome.
  _speakOne(chunk, isAborted) {
    return new Promise((resolve) => {
      if (isAborted()) return resolve();
      let done = false, keep = null, guard = null;
      const finish = () => {
        if (done) return; done = true;
        if (keep) clearInterval(keep);
        if (guard) clearTimeout(guard);
        resolve();
      };
      try {
        this.synth.cancel();
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = this.voice?.lang || "es-ES";
        if (this.voice) u.voice = this.voice;
        u.rate = this.rate;
        u.pitch = this.pitch;
        u.onend = finish;
        u.onerror = finish;
        this.synth.speak(u);
        // Keepalive: Chrome detiene la locución tras ~15 s; pause+resume la mantiene viva.
        keep = setInterval(() => {
          if (isAborted()) { try { this.synth.cancel(); } catch {} return finish(); }
          try { this.synth.pause(); this.synth.resume(); } catch {}
        }, 9000);
        // Failsafe AMPLIO (por si onend nunca llega): proporcional, SIN tope bajo que corte la voz.
        guard = setTimeout(finish, Math.max(5000, chunk.length * 150));
      } catch { finish(); }
    });
  }

  cancel() {
    if (this.synth) this.synth.cancel();
  }
}
