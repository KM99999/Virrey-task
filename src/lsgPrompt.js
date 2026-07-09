// Definición del LSG (Learning Scene Graph) y el prompt que fuerza a la IA a
// devolverlo. El LSG es la salida estructurada que el PRE Light valida y que en
// la Fase 2 el PSE Light reproducirá sincronizando voz + revelación visual.
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
Escena con "modulos": array de { "id", "directivas": [...] }. Módulos: "concepto" (explica la
idea con "hablar" + ejemplo en "pizarra"), "regla" (la regla clave explicada), "ejemplo_guiado"
(un ejemplo resuelto paso a paso, cada paso explicado con "hablar"), "practica" (termina con la
directiva "preguntar" del ejercicio nuevo). Cada módulo empieza explicando con "hablar".`
    : `FORMATO SECUENCIAL (intención "${intent}"):
Escena con "directivas": array plano en orden. Resuelve/explica paso a paso: para CADA paso,
"hablar" (el porqué) y luego "pizarra" (el paso). Cierra con la "preguntar" del ejercicio nuevo.`
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
