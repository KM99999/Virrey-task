// PRE Light — Motor de Resolución Pedagógica (versión ligera, Fase 1).
//
// Su trabajo: tomar el LSG que devuelve la IA (que puede venir imperfecto) y
// garantizar bloques PREDECIBLES para el resto del sistema. Sin esta capa, el
// PSE Light de la Fase 2 no tendría eventos fiables que sincronizar.
//
// Qué hace:
//   - Valida y normaliza la estructura de la escena (secuencial o modular).
//   - Sanea cada directiva: verifica `tipo`, completa campos por defecto y
//     descarta las que no tienen sentido.
//   - Numera las directivas (id incremental) para que el PSE Light tenga
//     referencias exactas.
//   - Asegura un cierre con "preguntar" cuando falta, para verificar comprensión.
//   - Calcula `duracion_estimada` si no vino.
//   - Devuelve además una lista PLANA de pasos (útil para render y depuración).

const TIPOS_VALIDOS = new Set([
  "avatar", "hablar", "esperar", "pizarra", "puntero", "preguntar",
]);

// Segundos estimados que "cuesta" cada directiva (para duracion_estimada).
const COSTO_SEGUNDOS = {
  avatar: 1,
  hablar: 4,
  esperar: (d) => Number(d.segundos) || 2,
  pizarra: 3,
  puntero: 2,
  preguntar: 5,
};

/**
 * Procesa y valida un LSG crudo.
 * @param {object} rawLsg
 * @param {string} intent - intención esperada (del clasificador).
 * @returns {{ lsg: object, pasos: object[], warnings: string[] }}
 */
export function processLSG(rawLsg, intent) {
  const warnings = [];

  if (!rawLsg || typeof rawLsg !== "object") {
    throw new Error("PRE Light: el LSG recibido no es un objeto válido.");
  }

  const modular = Array.isArray(rawLsg.modulos);
  const secuencial = Array.isArray(rawLsg.directivas);

  if (!modular && !secuencial) {
    throw new Error(
      "PRE Light: el LSG no contiene ni 'directivas' ni 'modulos'."
    );
  }

  // Contador global de ids de directiva, compartido entre módulos.
  let counter = { n: 0 };

  const lsg = {
    escena: typeof rawLsg.escena === "string" && rawLsg.escena.trim()
      ? rawLsg.escena.trim()
      : `escena_${intent}`,
    intencion: rawLsg.intencion || intent,
    duracion_estimada: 0, // se recalcula abajo
  };

  if (rawLsg.intencion && rawLsg.intencion !== intent) {
    warnings.push(
      `La intención del LSG ("${rawLsg.intencion}") difiere de la detectada ("${intent}").`
    );
  }

  const pasos = [];

  if (modular) {
    lsg.modulos = rawLsg.modulos
      .map((mod, i) => {
        const directivas = normalizeDirectivas(
          mod?.directivas, counter, warnings, pasos, `modulo[${i}]`
        );
        return {
          id: typeof mod?.id === "string" && mod.id.trim()
            ? mod.id.trim()
            : `modulo_${i + 1}`,
          directivas,
        };
      })
      .filter((m) => m.directivas.length > 0);

    if (lsg.modulos.length === 0) {
      throw new Error("PRE Light: ningún módulo contenía directivas válidas.");
    }

    // Asegurar que el último módulo cierre con una pregunta.
    ensureClosingQuestion(
      lsg.modulos[lsg.modulos.length - 1].directivas, counter, pasos, intent
    );
  } else {
    lsg.directivas = normalizeDirectivas(
      rawLsg.directivas, counter, warnings, pasos, "escena"
    );

    if (lsg.directivas.length === 0) {
      throw new Error("PRE Light: la escena no contenía directivas válidas.");
    }

    ensureClosingQuestion(lsg.directivas, counter, pasos, intent);
  }

  lsg.duracion_estimada = Number(rawLsg.duracion_estimada) > 0
    ? Number(rawLsg.duracion_estimada)
    : estimateDuration(pasos);

  return { lsg, pasos, warnings };
}

// Normaliza un array de directivas, numerándolas y saneándolas.
function normalizeDirectivas(arr, counter, warnings, pasos, context) {
  if (!Array.isArray(arr)) return [];

  const out = [];
  for (const raw of arr) {
    const dir = sanitizeDirectiva(raw, warnings, context);
    if (!dir) continue;
    dir.id = ++counter.n;
    out.push(dir);
    pasos.push({ ...dir });
  }
  return out;
}

// Sanea una directiva individual; devuelve null si es irrecuperable.
function sanitizeDirectiva(raw, warnings, context) {
  if (!raw || typeof raw !== "object" || !TIPOS_VALIDOS.has(raw.tipo)) {
    warnings.push(`Directiva descartada en ${context}: tipo inválido o ausente.`);
    return null;
  }

  const d = { tipo: raw.tipo };

  switch (raw.tipo) {
    case "avatar":
      d.accion = str(raw.accion) || "neutral";
      break;
    case "hablar":
      if (!str(raw.texto)) {
        warnings.push(`"hablar" sin texto descartada en ${context}.`);
        return null;
      }
      d.texto = sanitizeMath(str(raw.texto));
      break;
    case "esperar":
      d.segundos = clampNumber(raw.segundos, 1, 10, 2);
      break;
    case "pizarra":
      d.accion = str(raw.accion) || "escribir";
      if (!str(raw.contenido)) {
        warnings.push(`"pizarra" sin contenido descartada en ${context}.`);
        return null;
      }
      d.contenido = sanitizeMath(str(raw.contenido));
      break;
    case "puntero":
      d.accion = str(raw.accion) || "resaltar";
      if (str(raw.objetivo)) d.objetivo = str(raw.objetivo);
      break;
    case "preguntar":
      if (!str(raw.texto)) {
        warnings.push(`"preguntar" sin texto descartada en ${context}.`);
        return null;
      }
      d.texto = sanitizeMath(str(raw.texto));
      d.esperar_respuesta = raw.esperar_respuesta !== false;
      d.si_correcto = str(raw.si_correcto) || "continuar";
      d.si_incorrecto = str(raw.si_incorrecto) || "mostrar_otro_ejemplo";
      break;
  }

  return d;
}

// Añade una pregunta de cierre si la última directiva no lo es.
function ensureClosingQuestion(directivas, counter, pasos, intent) {
  const last = directivas[directivas.length - 1];
  if (last && last.tipo === "preguntar") return;

  const pregunta = {
    id: ++counter.n,
    tipo: "preguntar",
    texto: intent === "aprender" || intent === "practicar"
      ? "¿Te gustaría practicar con otro ejemplo?"
      : "¿Entendiste este paso?",
    esperar_respuesta: true,
    si_correcto: intent === "practicar" ? "felicitar" : "continuar",
    si_incorrecto: "mostrar_otro_ejemplo",
  };
  directivas.push(pregunta);
  pasos.push({ ...pregunta });
}

function estimateDuration(pasos) {
  return pasos.reduce((total, d) => {
    const costo = COSTO_SEGUNDOS[d.tipo];
    return total + (typeof costo === "function" ? costo(d) : costo || 1);
  }, 0);
}

// --- helpers ---
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// Limpia notación LaTeX / signos de dólar que la IA pueda deslizar, y la convierte
// a texto plano legible (la pizarra y el TTS no renderizan LaTeX). Ej.:
//   "$x^2 - 9 = (x-3)(x+3)$"  →  "x² - 9 = (x-3)(x+3)"
//   "$a^2 \\implies a = x$"    →  "a² ⇒ a = x"
function sanitizeMath(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/\$+/g, "")                                   // delimitadores $…$
    .replace(/\\implies|\\Rightarrow/g, " ⇒ ")
    .replace(/\\rightarrow|\\to\b/g, " → ")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\neq/g, "≠")
    .replace(/\\sqrt\s*\{([^}]*)\}/g, "√($1)")
    .replace(/\\sqrt/g, "√")
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\^\{\s*2\s*\}|\^2/g, "²")
    .replace(/\^\{\s*3\s*\}|\^3/g, "³")
    .replace(/\^\{\s*n\s*\}|\^n/g, "ⁿ")
    .replace(/\\[a-zA-Z]+/g, "")                            // comandos LaTeX restantes
    .replace(/[{}]/g, "")                                   // llaves sueltas
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
