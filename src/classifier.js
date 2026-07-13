// Clasificador de intención (Fase 1).
// Distingue las 4 intenciones del proyecto a partir del texto del alumno:
//   - resolver : resolver un ejercicio concreto  ("Resuelve 2x + 5 = 15")
//   - aprender : aprender un tema                 ("Enséñame derivadas")
//   - explicar : pedir una explicación            ("¿Por qué se factoriza?")
//   - practicar: pedir un ejercicio de práctica   ("Dame un ejercicio de fracciones")
//
// Enfoque: reglas por palabras clave + señales estructurales (presencia de
// ecuaciones/números). Es un clasificador "básico" y transparente, ideal para un
// prototipo: rápido, sin coste de API y fácil de depurar. La intención resultante
// se le pasa después a la IA para que el LSG salga acorde.

export const INTENTS = ["resolver", "aprender", "explicar", "practicar"];

// Palabras/expresiones que apuntan a cada intención (en minúsculas, sin tildes).
const KEYWORDS = {
  practicar: [
    "dame un ejercicio", "ejercicio de practica", "quiero practicar",
    "practicar", "practica", "ponme un ejercicio", "otro ejercicio",
    "un problema de", "ejercitar",
  ],
  aprender: [
    "ensename", "aprender", "quiero aprender", "aprendo",
    "tema de", "introduccion a", "que es", "concepto de", "temario",
  ],
  explicar: [
    "explica", "explicame", "por que", "porque razon", "como funciona",
    "no entiendo", "que significa", "razon de", "justifica", "demuestra por que",
  ],
  resolver: [
    "resuelve", "resolver", "calcula", "halla", "encuentra el valor",
    "cuanto es", "simplifica", "factoriza", "deriva ", "integra ",
    "despeja", "opera",
  ],
};

// Normaliza: minúsculas, sin tildes (elimina marcas diacríticas U+0300–U+036F),
// espacios colapsados.
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ¿El texto contiene una ecuación o expresión matemática concreta?
function looksLikeConcreteExercise(norm) {
  const hasEquation = /[a-z0-9]\s*=\s*[a-z0-9]/.test(norm);         // "2x = 10"
  const hasOperator = /\d\s*[+\-*/^]\s*\d/.test(norm);              // "2 + 5"
  const hasVarAndNum = /\d[a-z]/.test(norm) || /[a-z]\d/.test(norm); // "2x", "x2"
  return hasEquation || hasOperator || hasVarAndNum;
}

function countMatches(norm, list) {
  return list.reduce((acc, kw) => (norm.includes(kw) ? acc + 1 : acc), 0);
}

// ¿El texto es una pregunta que pide la RAZÓN de algo? ("¿por qué…?", "para qué…").
// Señal fuerte de "explicar": desempata frente a palabras que también apuntan a
// "resolver" (p.ej. "¿por qué se factoriza?" → explicar, no resolver).
// OJO: excluimos "para que yo/tú … resuelva" (eso es finalidad, no razón → practicar).
function asksForReason(norm) {
  if (/\bpara que (yo|tu|el|ella|nosotros)?\s*(lo|la|los|las)?\s*(resuelva|resuelvas|practique|trabaje|intente|haga)/.test(norm)) {
    return false;
  }
  return /\bpor que\b|\bpara que\b|\bpor que razon\b|\brazon de\b/.test(norm);
}

// ¿El alumno pide que le DEN un ejercicio/ecuación para resolverlo ÉL MISMO? → practicar.
// Es distinto de pedir la SOLUCIÓN de una ecuación concreta (eso es "resolver").
// Corrige el caso: "dame una ecuación lineal para resolver" NO debe resolvérsela la app,
// sino entregar el ejercicio para que lo resuelva el alumno.
function pideQueLeDenEjercicio(norm) {
  // Pedir el resultado/solución NO es practicar, es resolver.
  if (/\b(la solucion|el resultado|la respuesta|dame el valor|dame la solucion|resuelveme)\b/.test(norm)) {
    return false;
  }
  // Si es claramente aprendizaje/explicación conceptual, tampoco es "dame ejercicio".
  if (/\b(aprender|aprende|ensename|ensename|entender|comprender|que es|concepto de)\b/.test(norm)) {
    return false;
  }
  // Verbo de "entrégame/genera" seguido (cerca) de un sustantivo de problema.
  const daProblema = /\b(dame|damelos?|proponme|propon|ponme|pon|genera|generame|crea|creame|hazme|haz|brindame|plantea|planteame|sugiere|sugiereme|regalame|facilitame)\b[\s\S]{0,30}\b(ejercicio|ejercicios|ecuacion|ecuaciones|problema|problemas)\b/;
  const paraPracticar = /\bpara (practicar|ejercitar|reforzar)\b/;
  const paraQueYoResuelva = /\bpara que (yo|tu)?\s*(lo|la|los|las)?\s*(resuelva|resuelvas|practique|trabaje|intente)\b|\bque yo\s*(lo|la|los|las)?\s*resuelva\b/;
  return daProblema.test(norm) || paraPracticar.test(norm) || paraQueYoResuelva.test(norm);
}

/**
 * Clasifica el texto en una de las 4 intenciones.
 * @param {string} text
 * @returns {{ intent: string, confidence: number, scores: Record<string, number> }}
 */
export function classifyIntent(text) {
  const norm = normalize(text);

  // Prioridad ALTA: "dame/proponme una ecuación (para practicar / que yo resuelva)".
  // El alumno quiere un ejercicio PARA ÉL, no que la app se lo resuelva.
  if (pideQueLeDenEjercicio(norm)) {
    return {
      intent: "practicar",
      confidence: 0.9,
      scores: { resolver: 0, aprender: 0, explicar: 0, practicar: 1 },
    };
  }

  const scores = {
    resolver: countMatches(norm, KEYWORDS.resolver),
    aprender: countMatches(norm, KEYWORDS.aprender),
    explicar: countMatches(norm, KEYWORDS.explicar),
    practicar: countMatches(norm, KEYWORDS.practicar),
  };

  // Señal estructural: una ecuación/expresión concreta refuerza "resolver".
  if (looksLikeConcreteExercise(norm)) scores.resolver += 1;

  // Señal estructural: una pregunta por la razón ("¿por qué…?") refuerza "explicar".
  if (asksForReason(norm)) scores.explicar += 1;

  // Elegir la intención con mayor puntaje.
  let best = "resolver"; // fallback razonable para un tutor de matemáticas
  let bestScore = -1;
  for (const intent of INTENTS) {
    if (scores[intent] > bestScore) {
      best = intent;
      bestScore = scores[intent];
    }
  }

  // Si nadie puntuó, decidir por presencia de matemática concreta:
  // hay ecuación → resolver; si no, probablemente quiere aprender un tema.
  if (bestScore <= 0) {
    best = looksLikeConcreteExercise(norm) ? "resolver" : "aprender";
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? Math.min(1, bestScore / total) : 0.3;

  return { intent: best, confidence: Number(confidence.toFixed(2)), scores };
}
