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
function asksForReason(norm) {
  return /\bpor que\b|\bpara que\b|\bpor que razon\b|\brazon de\b/.test(norm);
}

/**
 * Clasifica el texto en una de las 4 intenciones.
 * @param {string} text
 * @returns {{ intent: string, confidence: number, scores: Record<string, number> }}
 */
export function classifyIntent(text) {
  const norm = normalize(text);

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
