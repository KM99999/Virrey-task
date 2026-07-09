// TTS — síntesis de voz en español (Fase 2).
// Envuelve la Web Speech API (SpeechSynthesis) y expone speak() como Promise que
// se resuelve cuando termina de hablar, para que el PSE Light pueda sincronizar
// la revelación del contenido con la voz del avatar.
//
// Si el navegador no tiene voz en español (o no soporta TTS), speak() cae en un
// retardo estimado por longitud del texto, para que la sincronización siga
// funcionando (el avatar "habla" con subtítulos aunque no haya audio).

export class TTS {
  constructor() {
    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    this.enabled = !!this.synth;
    this.voice = null;
    this.rate = 1.0;
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
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      if (!text) return resolve();

      // Fallback sin audio: retardo proporcional a la longitud del texto.
      const timedFallback = () => {
        const ms = Math.min(9000, Math.max(1200, text.length * 55));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      };

      if (!this.enabled || !this.voice) return timedFallback();

      try {
        this.synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = this.voice?.lang || "es-ES";
        if (this.voice) u.voice = this.voice;
        u.rate = this.rate;
        u.pitch = this.pitch;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        u.onend = finish;
        u.onerror = finish;
        signal?.addEventListener("abort", () => { this.synth.cancel(); finish(); }, { once: true });
        this.synth.speak(u);
        // Salvaguarda: si el navegador nunca dispara onend, no colgar la escena.
        const guard = setTimeout(finish, Math.min(15000, Math.max(3000, text.length * 120)));
        u.onend = () => { clearTimeout(guard); finish(); };
      } catch {
        timedFallback();
      }
    });
  }

  cancel() {
    if (this.synth) this.synth.cancel();
  }
}
