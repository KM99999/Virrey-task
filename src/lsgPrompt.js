// Definición del LSG (Learning Scene Graph) y el prompt que fuerza a la IA a
// devolverlo. El LSG es la salida estructurada que el PRE Light valida y que en
// la Fase 2 el PSE Light reproducirá sincronizando voz + revelación visual.

import { solveLinearSteps } from "./preLight.js";
//
// Dos formas según la intención:
//   - resolver / explicar → escena SECUENCIAL con `directivas: [...]`
//   - aprender / practicar → escena MODULAR con `modulos: [{ id, directivas }]`
//
// Directivas (eventos discretos) que el PSE Light sabrá ejecutar:
//   avatar    { tipo, accion }                         p.ej. accion: "sonreir"
//   hablar    { tipo, texto }                          el avatar habla (español)
//   esperar   { tipo, segundos }                       pausa
//   pizarra   { tipo, accion:"escribir", contenido }   escribe en la pizarra
//   puntero   { tipo, accion:"resaltar", objetivo }    resalta algo ya escrito
//   preguntar { tipo, texto, esperar_respuesta, si_correcto, si_incorrecto }

// Esquema de respuesta para Gemini (structured output). Campos por-directiva
// opcionales salvo `tipo`, porque cada tipo usa un subconjunto distinto.
export const LSG_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    escena: { type: "string" },
    intencion: {
      type: "string",
      enum: ["resolver", "aprender", "explicar", "practicar"],
    },
    duracion_estimada: { type: "number" },
    directivas: {
      type: "array",
      items: directivaSchema(),
    },
    modulos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          directivas: { type: "array", items: directivaSchema() },
        },
        required: ["id", "directivas"],
      },
    },
  },
  required: ["escena", "intencion"],
};

function directivaSchema() {
  return {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["avatar", "hablar", "esperar", "pizarra", "puntero", "preguntar"],
      },
      accion: { type: "string" },
      texto: { type: "string" },
      contenido: { type: "string" },
      segundos: { type: "number" },
      objetivo: { type: "string" },
      esperar_respuesta: { type: "boolean" },
      respuesta: { type: "string" },
      si_correcto: { type: "string" },
      si_incorrecto: { type: "string" },
    },
    required: ["tipo"],
  };
}

/**
 * Construye la instrucción de sistema que fuerza el LSG.
 * @param {string} intent - intención detectada por el clasificador.
 */
export function buildSystemInstruction(intent) {
  const modular = intent === "aprender" || intent === "practicar";

  return `Eres el motor pedagógico de "Math IA", un tutor de matemáticas para alumnos.
Tu ÚNICA salida es un objeto JSON válido que representa un "Learning Scene Graph" (LSG):
una escena de directivas discretas que un avatar reproduce EN ESPAÑOL mientras el
contenido aparece en una pizarra de forma progresiva.

════════ METODOLOGÍA DE ENSEÑANZA (lo MÁS importante — ENSEÑA, no solo resuelvas) ════════
El corazón de la app es CÓMO se enseña. Resolver el ejercicio sin explicar es un ERROR grave.
- Explica el RAZONAMIENTO de cada paso. ANTES de escribir cada paso en la pizarra, incluye
  una directiva "hablar" que explique POR QUÉ se hace (la regla o el concepto), con lenguaje
  claro y cercano — no solo qué se escribe, sino por qué.
  Ejemplo para "2x + x = 12":
    hablar: "Primero juntamos los términos que tienen x: 2x más x son 3x." → pizarra: "3x = 12"
    hablar: "Para dejar la x sola, dividimos ambos lados entre 3." → pizarra: "x = 4"
    hablar: "Así, la x vale 4. ¡Comprobémoslo!" (cierra con sentido).
- CADA "hablar" DEBE tener texto real y con significado. PROHIBIDO un "hablar" vacío.
  PROHIBIDO escribir un paso en la pizarra sin haberlo explicado antes con una "hablar".
- Ritmo por paso: hablar (el porqué) → pizarra (el paso) → esperar (1-2 s) → puntero (resalta lo clave).
- Metodología según el alumno: tema nuevo → explicación guiada; ejercicio → resolver paso a paso
  explicando cada transformación; si algo es sutil, usa preguntas guía (método socrático).

════════ PREGUNTA FINAL (evita preguntas triviales) ════════
- Cierra con UNA sola directiva "preguntar" que sea un EJERCICIO NUEVO de práctica: similar al
  que enseñaste pero con NÚMEROS DISTINTOS, para que el alumno lo resuelva por su cuenta.
- PROHIBIDO preguntar por un valor que YA está escrito en la pizarra (sería trivial).
  MAL: resolviste y quedó "x = 4", y preguntas "¿cuánto vale x?".
  BIEN: enseñaste "2x + x = 12"; preguntas "Ahora te toca a ti: ¿cuánto vale x en x + 5 = 9?".
- Incluye SIEMPRE el campo "respuesta" con la respuesta del NUEVO ejercicio, corta (p.ej. "4").
- Debe terminar con "?". Las opciones/ecuaciones van dentro de su "texto", no como "preguntar" sueltas.
- "esperar_respuesta": true. "si_correcto"/"si_incorrecto" son ETIQUETAS: EXACTAMENTE
  "continuar", "felicitar" o "mostrar_otro_ejemplo" (no pongas frases ahí).

════════ FORMATO ════════
- Devuelve SOLO JSON, sin markdown. "intencion" debe ser exactamente: "${intent}".
- Notación en TEXTO PLANO (NADA de LaTeX ni "$"): usa Unicode (x², √, ·, ⇒, fracciones "a/b").
  NO uses "\\frac", "\\implies", "\\sqrt", "^{}".

${
  modular
    ? `FORMATO MODULAR (intención "${intent}"):
Escena con "modulos": array de { "id", "directivas": [...] }. Módulos: "concepto", "regla",
"ejemplo_guiado", "practica" (este último termina con la "preguntar" del ejercicio nuevo).
OBLIGATORIO en CADA módulo: la PRIMERA directiva es un "hablar" con TEXTO REAL, y CADA "pizarra"
va precedida de un "hablar" que la explica. Un módulo con "pizarra" pero sin "hablar" es un ERROR.
Ejemplo de módulo bien hecho (fíjate que cada "hablar" tiene texto de verdad):
{ "id": "concepto", "directivas": [
  { "tipo": "hablar", "texto": "Una ecuación es como una balanza: lo de un lado vale igual que lo del otro." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "x + 3 = 5" },
  { "tipo": "hablar", "texto": "La x es el número que no conocemos y que queremos descubrir." },
  { "tipo": "esperar", "segundos": 2 }
]}`
    : `FORMATO SECUENCIAL (intención "${intent}"):
Escena con "directivas": array plano en orden. Para CADA paso: PRIMERO un "hablar" con TEXTO
REAL que explique el porqué, y LUEGO la "pizarra" con el paso. Un paso en "pizarra" sin su
"hablar" antes es un ERROR. Cierra con la "preguntar" del ejercicio nuevo.
Ejemplo bien hecho (fíjate que cada "hablar" tiene texto de verdad):
"directivas": [
  { "tipo": "hablar", "texto": "Vamos a resolver 2x + x = 12. Primero juntamos los términos que tienen x." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "3x = 12" },
  { "tipo": "hablar", "texto": "Ahora dividimos ambos lados entre 3 para dejar la x sola." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "x = 4" },
  { "tipo": "preguntar", "texto": "Ahora te toca a ti: ¿cuánto vale x en x + 5 = 9?", "respuesta": "4",
    "esperar_respuesta": true, "si_correcto": "felicitar", "si_incorrecto": "mostrar_otro_ejemplo" }
]`
}

Estructura general:
{
  "escena": "<nombre_corto_snake_case>",
  "intencion": "${intent}",
  "duracion_estimada": <segundos aproximados>,
  ${modular ? '"modulos": [ { "id": "...", "directivas": [ ... ] } ]' : '"directivas": [ ... ]'}
}`;
}

// --- Generador simulado (fallback) -----------------------------------------
// Se usa cuando no hay GEMINI_API_KEY, para que el prototipo arranque y se pueda
// probar el flujo completo sin coste. Produce un LSG con la forma correcta.
export function mockLSG(query, intent) {
  // Si la consulta tiene una ecuación lineal, el modo demo la RESUELVE de verdad,
  // paso a paso (así sirve aunque no haya créditos de Gemini).
  const solved = solveLinearSteps(query);
  if (solved) {
    const directivas = [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: `Vamos a resolver ${solved.original} paso a paso.` },
      { tipo: "pizarra", accion: "escribir", contenido: solved.original },
      { tipo: "esperar", segundos: 1 },
    ];
    for (const s of solved.steps) {
      directivas.push({ tipo: "hablar", texto: s.explica });
      directivas.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe });
      directivas.push({ tipo: "esperar", segundos: 1 });
    }
    directivas.push({
      tipo: "preguntar",
      texto: `Ahora te toca a ti: ¿cuánto vale ${solved.varName} en ${solved.varName} + 2 = 6?`,
      respuesta: "4",
      esperar_respuesta: true,
      si_correcto: "felicitar",
      si_incorrecto: "mostrar_otro_ejemplo",
    });
    return { escena: "demo_resuelto", intencion: intent, duracion_estimada: 60, _mock: true, directivas };
  }

  if (intent === "aprender" || intent === "practicar") {
    return {
      escena: "demo_modular",
      intencion: intent,
      duracion_estimada: 120,
      _mock: true,
      modulos: [
        {
          id: "concepto",
          directivas: [
            { tipo: "avatar", accion: "sonreir" },
            { tipo: "hablar", texto: `Vamos a ver el tema de tu consulta: "${query}".` },
            { tipo: "pizarra", accion: "escribir", contenido: "Concepto principal" },
            { tipo: "esperar", segundos: 2 },
          ],
        },
        {
          id: "practica",
          directivas: [
            { tipo: "hablar", texto: "Ahora practica tú." },
            {
              tipo: "preguntar",
              texto: "¿Podrías resolver un ejemplo similar?",
              esperar_respuesta: true,
              si_correcto: "felicitar",
              si_incorrecto: "mostrar_otro_ejemplo",
            },
          ],
        },
      ],
    };
  }

  return {
    escena: "demo_secuencial",
    intencion: intent,
    duracion_estimada: 60,
    _mock: true,
    directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: `Trabajemos tu consulta: "${query}".` },
      { tipo: "pizarra", accion: "escribir", contenido: query },
      { tipo: "esperar", segundos: 2 },
      { tipo: "hablar", texto: "Este es el resultado paso a paso (demo sin IA)." },
      {
        tipo: "preguntar",
        texto: "¿Entendiste este paso?",
        esperar_respuesta: true,
        si_correcto: "continuar",
        si_incorrecto: "mostrar_otro_ejemplo",
      },
    ],
  };
}
