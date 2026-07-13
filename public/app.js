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

  setLoading(true);
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detalle || data.error || `Error ${res.status}`);
    }

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
  els.pillSource.textContent = `IA: ${data.fuente_ia === "gemini" ? "Gemini" : "demo/mock"}`;
  els.pillDuration.textContent = `Duración: ~${data.lsg.duracion_estimada}s`;

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
  history.length = 0;
  renderHistory();
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
