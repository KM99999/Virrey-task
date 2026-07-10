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

// Etiquetas de control válidas para si_correcto / si_incorrecto.
const CONTROL_LABELS = new Set(["continuar", "felicitar", "mostrar_otro_ejemplo"]);
function normLabel(v, fallback) {
  const s = (typeof v === "string" ? v : "").trim().toLowerCase();
  return CONTROL_LABELS.has(s) ? s : fallback;
}

// Deriva la respuesta esperada resolviendo una ecuación lineal simple embebida en
// el texto de una pregunta: "a·x + b = c" → x = (c - b)/a. Gemini no rellena el
// campo "respuesta" de forma fiable, así que la calculamos para poder calificar.
// Devuelve la solución como string, o null si no es una ecuación lineal simple
// (en cuyo caso el PSE Light tratará la pregunta como de comprensión, sin juzgar).
export function solveLinearFromText(text) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  // Ecuación lineal compacta: términos (coef·var o número) unidos por + / -, = número.
  // Captura toda la parte izquierda (varios términos), p.ej. "3x + x", "2x - 3".
  const m = t.match(
    /((?:[+-]\s*)?(?:\d*[a-z]|\d+(?:\.\d+)?)(?:\s*[+-]\s*(?:\d*[a-z]|\d+(?:\.\d+)?))*)\s*=\s*(-?\d+(?:\.\d+)?)(?![a-z0-9.])/
  );
  if (!m) return null;
  const lhs = m[1];
  const c = Number(m[2]);
  if (!Number.isFinite(c)) return null;

  // Debe haber exactamente UNA variable (rechaza multivariable y expresiones raras).
  const letters = new Set((lhs.match(/[a-z]/g) || []));
  if (letters.size !== 1) return null;
  const v = [...letters][0];

  // Sumar términos semejantes: coeficiente total de la variable y constante total.
  let expr = lhs.replace(/\s+/g, "");
  if (!/^[+-]/.test(expr)) expr = "+" + expr;
  const terms = expr.match(/[+-](?:\d*[a-z]|\d+(?:\.\d+)?)/g);
  if (!terms) return null;

  let coef = 0;
  let konst = 0;
  for (const term of terms) {
    const sign = term[0] === "-" ? -1 : 1;
    const body = term.slice(1);
    if (body.includes(v)) {
      const num = body.replace(v, "");
      const k = num === "" ? 1 : Number(num);
      if (!Number.isFinite(k)) return null; // p.ej. "x²" → no lineal
      coef += sign * k;
    } else {
      const k = Number(body);
      if (!Number.isFinite(k)) return null;
      konst += sign * k;
    }
  }
  if (coef === 0) return null;

  const x = (c - konst) / coef;
  if (!Number.isFinite(x)) return null;
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000);
}

// Genera los PASOS de resolución de una ecuación lineal simple, para el modo demo
// (sin IA): permite que "2x + x = 12" muestre una solución real paso a paso.
// Devuelve { original, steps:[{explica, escribe}], answer, varName } o null.
export function solveLinearSteps(text) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  const m = t.match(
    /((?:[+-]\s*)?(?:\d*[a-z]|\d+(?:\.\d+)?)(?:\s*[+-]\s*(?:\d*[a-z]|\d+(?:\.\d+)?))*)\s*=\s*(-?\d+(?:\.\d+)?)/
  );
  if (!m) return null;
  const lhs = m[1];
  const c = Number(m[2]);
  if (!Number.isFinite(c)) return null;
  const letters = new Set((lhs.match(/[a-z]/g) || []));
  if (letters.size !== 1) return null;
  const v = [...letters][0];

  let expr = lhs.replace(/\s+/g, "");
  if (!/^[+-]/.test(expr)) expr = "+" + expr;
  const terms = expr.match(/[+-](?:\d*[a-z]|\d+(?:\.\d+)?)/g);
  if (!terms) return null;

  let coef = 0, konst = 0, xTerms = 0;
  for (const term of terms) {
    const sign = term[0] === "-" ? -1 : 1;
    const body = term.slice(1);
    if (body.includes(v)) {
      const num = body.replace(v, "");
      const k = num === "" ? 1 : Number(num);
      if (!Number.isFinite(k)) return null;
      coef += sign * k; xTerms++;
    } else {
      const k = Number(body);
      if (!Number.isFinite(k)) return null;
      konst += sign * k;
    }
  }
  if (coef === 0) return null;
  const answer = (c - konst) / coef;
  if (!Number.isFinite(answer)) return null;

  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
  const xc = (k) => (k === 1 ? "" : k === -1 ? "-" : fmt(k)); // coeficiente legible
  const original = `${lhs.trim().replace(/\s+/g, " ")} = ${fmt(c)}`;
  const steps = [];

  if (xTerms > 1) {
    const combined = konst === 0
      ? `${xc(coef)}${v} = ${fmt(c)}`
      : `${xc(coef)}${v} ${konst > 0 ? "+ " + fmt(konst) : "- " + fmt(-konst)} = ${fmt(c)}`;
    steps.push({ explica: `Juntamos los términos que tienen ${v}: en total son ${xc(coef)}${v}.`, escribe: combined });
  }
  if (konst !== 0) {
    const op = konst > 0 ? `restamos ${fmt(konst)}` : `sumamos ${fmt(-konst)}`;
    steps.push({ explica: `Para despejar, ${op} en ambos lados (operación inversa).`, escribe: `${xc(coef)}${v} = ${fmt(c - konst)}` });
  }
  if (coef !== 1) {
    steps.push({ explica: `Dividimos ambos lados entre ${fmt(coef)} para dejar ${v} sola.`, escribe: `${v} = ${fmt(answer)}` });
  }
  if (steps.length === 0 || !steps[steps.length - 1].escribe.startsWith(`${v} =`)) {
    steps.push({ explica: `Entonces, ${v} vale ${fmt(answer)}.`, escribe: `${v} = ${fmt(answer)}` });
  }
  return { original, steps, answer: fmt(answer), varName: v };
}

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
  } else {
    lsg.directivas = normalizeDirectivas(
      rawLsg.directivas, counter, warnings, pasos, "escena"
    );

    if (lsg.directivas.length === 0) {
      throw new Error("PRE Light: la escena no contenía directivas válidas.");
    }
  }

  // Garantizar EXACTAMENTE una pregunta en toda la lección (la IA a veces genera
  // varias "preguntar" casi idénticas → dos cajas de respuesta). Si no hay ninguna,
  // se añade una de cierre.
  enforceSingleQuestion(lsg, pasos, counter, intent);

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
    case "preguntar": {
      const texto = sanitizeMath(str(raw.texto));
      if (!texto) {
        warnings.push(`"preguntar" sin texto descartada en ${context}.`);
        return null;
      }
      let respuesta = sanitizeMath(str(raw.respuesta));
      // Gemini a veces mete ecuaciones, opciones o enunciados como "preguntar".
      // Si no es una pregunta real (sin "?" y sin respuesta esperada), se narra en
      // vez de abrir la caja de respuesta — evita pedir "responder" a una ecuación.
      if (!texto.includes("?") && !respuesta) {
        warnings.push(`"preguntar" sin forma de pregunta convertida a "hablar" en ${context}.`);
        return { tipo: "hablar", texto };
      }
      // Si es una pregunta real pero la IA no dio respuesta, intentamos derivarla
      // resolviendo la ecuación lineal embebida (p.ej. "¿valor de x en 2x-3=7?" → "5").
      if (!respuesta) respuesta = solveLinearFromText(texto) || "";
      d.texto = texto;
      d.esperar_respuesta = raw.esperar_respuesta !== false;
      if (respuesta) d.respuesta = respuesta;
      // si_correcto/si_incorrecto son etiquetas de CONTROL; si la IA metió una frase,
      // se normaliza a la etiqueta por defecto para no romper la lógica de ramificación.
      d.si_correcto = normLabel(raw.si_correcto, "continuar");
      d.si_incorrecto = normLabel(raw.si_incorrecto, "mostrar_otro_ejemplo");
      break;
    }
  }

  return d;
}

// Conserva SOLO la primera "preguntar" de toda la lección (elimina duplicadas de la
// IA) y, si no hay ninguna, añade una de cierre. Luego reconstruye `pasos`.
function enforceSingleQuestion(lsg, pasos, counter, intent) {
  const arrays = Array.isArray(lsg.modulos)
    ? lsg.modulos.map((m) => m.directivas)
    : [lsg.directivas];

  let seen = false;
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].tipo === "preguntar") {
        if (seen) { arr.splice(i, 1); i--; } // quitar preguntas extra
        else seen = true;                    // conservar la primera
      }
    }
  }

  if (!seen) {
    const last = arrays[arrays.length - 1];
    last.push({
      id: ++counter.n,
      tipo: "preguntar",
      texto: intent === "aprender" || intent === "practicar"
        ? "¿Te gustaría practicar con otro ejemplo?"
        : "¿Entendiste la explicación?",
      esperar_respuesta: true,
      si_correcto: intent === "practicar" ? "felicitar" : "continuar",
      si_incorrecto: "mostrar_otro_ejemplo",
    });
  }

  // Reconstruir `pasos` con las directivas resultantes, en orden.
  pasos.length = 0;
  for (const arr of arrays) for (const d of arr) pasos.push({ ...d });
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
