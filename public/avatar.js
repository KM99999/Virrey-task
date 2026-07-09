// Avatar visual 2D básico (Fase 2).
// Un rostro SVG simple, sin 3D, controlado por estados. El PSE Light cambia su
// estado según la directiva en curso (habla, sonríe, pregunta, piensa) y activa
// la animación de "boca hablando" mientras la voz TTS está activa.
//
// Estados: neutral | hablando | sonriendo | preguntando | pensando

const MOUTHS = {
  neutral:     "M 42 74 Q 60 80 78 74",
  hablando:    "M 44 72 Q 60 88 76 72 Q 60 80 44 72 Z", // boca abierta (se anima)
  sonriendo:   "M 40 72 Q 60 94 80 72",
  preguntando: "M 52 78 Q 60 84 68 78",
  pensando:    "M 48 78 L 72 74",
};

const BROWS = {
  neutral:     { l: "M 38 46 L 52 44", r: "M 68 44 L 82 46" },
  hablando:    { l: "M 38 46 L 52 44", r: "M 68 44 L 82 46" },
  sonriendo:   { l: "M 38 45 L 52 43", r: "M 68 43 L 82 45" },
  preguntando: { l: "M 38 44 L 52 40", r: "M 68 46 L 82 44" }, // una ceja alzada
  pensando:    { l: "M 38 43 L 52 41", r: "M 68 45 L 82 43" },
};

const SVG_NS = "http://www.w3.org/2000/svg";

export class Avatar {
  /** @param {HTMLElement} mount - contenedor donde se monta el SVG. */
  constructor(mount) {
    this.mount = mount;
    this.state = "neutral";
    this._build();
    this.setState("neutral");
  }

  _build() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.classList.add("avatar-svg");

    const el = (tag, attrs) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };

    // Cabeza
    svg.appendChild(el("circle", { cx: 60, cy: 60, r: 42, class: "av-face" }));
    // Ojos
    svg.appendChild(el("circle", { cx: 45, cy: 56, r: 5, class: "av-eye" }));
    svg.appendChild(el("circle", { cx: 75, cy: 56, r: 5, class: "av-eye" }));
    // Cejas
    this.browL = el("path", { d: BROWS.neutral.l, class: "av-brow" });
    this.browR = el("path", { d: BROWS.neutral.r, class: "av-brow" });
    svg.append(this.browL, this.browR);
    // Boca
    this.mouth = el("path", { d: MOUTHS.neutral, class: "av-mouth" });
    svg.appendChild(this.mouth);

    this.svg = svg;
    this.mount.classList.add("avatar");
    this.mount.appendChild(svg);
  }

  setState(state) {
    if (!MOUTHS[state]) state = "neutral";
    this.state = state;
    this.mouth.setAttribute("d", MOUTHS[state]);
    this.browL.setAttribute("d", BROWS[state].l);
    this.browR.setAttribute("d", BROWS[state].r);
    this.mount.dataset.state = state;
  }

  // Activa/desactiva la animación de boca mientras el avatar habla.
  setSpeaking(on) {
    this.mount.classList.toggle("speaking", !!on);
  }
}
