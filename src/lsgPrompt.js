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
una escena compuesta por directivas discretas que un avatar reproducirá en español,
mientras el contenido matemático aparece en una pizarra de forma progresiva.

REGLAS DE SALIDA:
- Devuelve SOLO JSON, sin texto adicional ni markdown.
- "intencion" debe ser exactamente: "${intent}".
- Todo el texto hablado ("hablar") y las preguntas van en ESPAÑOL, claros y didácticos.
- Usa notación matemática legible en TEXTO PLANO (p.ej. "2x + 5 = 15", "x = 5", "f'(x) = 3x²").
- PROHIBIDO usar LaTeX o signos de dólar: NO escribas "$...$", "\\frac", "\\implies", "\\sqrt", "^{}".
  Usa Unicode directo: potencias con ² ³ ⁿ (p.ej. "x²"), raíz "√", multiplicación "·", "⇒", fracciones "a/b".
- Ordena las directivas en el orden pedagógico correcto: habla, escribe, resalta, pausa.
- Incluye pausas ("esperar", 1-3 s) para que el alumno siga el ritmo.
- Cierra con UNA sola directiva "preguntar" que verifique comprensión. REGLAS de "preguntar":
  * Debe ser UNA pregunta real y terminar con "?". NO uses varias "preguntar" seguidas para
    una misma pregunta. Las opciones (A, B, C…), ecuaciones o enunciados van dentro del propio
    campo "texto" de esa pregunta, o en directivas "pizarra"/"hablar" — NUNCA como "preguntar".
  * Incluye SIEMPRE el campo "respuesta" con la respuesta correcta esperada, corta (p.ej. "x = 4",
    "A", "desconocido"). Sin "respuesta" el sistema no puede evaluar al alumno.
  * "esperar_respuesta": true. "si_correcto"/"si_incorrecto" son ETIQUETAS de control, usa
    EXACTAMENTE una de: "continuar", "felicitar", "mostrar_otro_ejemplo" (no pongas frases ahí).

${
  modular
    ? `FORMATO MODULAR (intención "${intent}"):
Devuelve la escena con "modulos": un array de módulos, cada uno { "id", "directivas": [...] }.
Módulos recomendados para aprender un tema: "concepto", "regla", "ejemplo_guiado", "practica".
El módulo "practica" debe terminar con una directiva "preguntar".`
    : `FORMATO SECUENCIAL (intención "${intent}"):
Devuelve la escena con "directivas": un array plano de directivas en orden.
Resuelve/explica paso a paso, escribiendo cada paso en la pizarra, y cierra con "preguntar".`
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
