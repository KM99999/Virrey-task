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

// Instrucción de sistema ESTABLE (idéntica en cada llamada) para poder cachearla en
// Gemini (Context Caching) y no pagar sus tokens de entrada en cada consulta. La
// intención (resolver/aprender/explicar/practicar) NO se interpola aquí: se pasa en el
// mensaje del usuario, y este prompt explica cómo elegir el formato según esa intención.
export const SYSTEM_INSTRUCTION = `Eres el motor pedagógico de "Math IA", un tutor de matemáticas para alumnos.
Tu ÚNICA salida es un objeto JSON válido que representa un "Learning Scene Graph" (LSG):
una escena de directivas discretas que un avatar reproduce EN ESPAÑOL mientras el
contenido aparece en una pizarra de forma progresiva.

En el mensaje del usuario recibirás la INTENCIÓN (una de: resolver, aprender, explicar,
practicar) y la consulta. El campo "intencion" del JSON debe ser EXACTAMENTE esa intención.

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
- COHERENCIA: justo ANTES de la "preguntar", escribe el ejercicio nuevo en una directiva
  "pizarra" (y anúncialo con "hablar"), para que la pizarra muestre EXACTAMENTE de lo que
  pregunta. La función/ecuación del texto de la pregunta debe ser la MISMA que la última
  escrita en la pizarra. NUNCA preguntes por "f(x) = x" mientras la pizarra muestra "f(x) = x⁵".
- Incluye SIEMPRE el campo "respuesta" con la respuesta del NUEVO ejercicio, corta (p.ej. "4").
- Debe terminar con "?". Las opciones/ecuaciones van dentro de su "texto", no como "preguntar" sueltas.
- "esperar_respuesta": true. "si_correcto"/"si_incorrecto" son ETIQUETAS: EXACTAMENTE
  "continuar", "felicitar" o "mostrar_otro_ejemplo" (no pongas frases ahí).

════════ FORMATO ════════
- Devuelve SOLO JSON, sin markdown.
- Notación en TEXTO PLANO (NADA de LaTeX ni "$"): usa Unicode (x², √, ·, ⇒, fracciones "a/b").
  NO uses "\\frac", "\\implies", "\\sqrt", "^{}".
- Elige el FORMATO según la intención:
  · Si la intención es "aprender" o "practicar" → FORMATO MODULAR.
  · Si la intención es "resolver" o "explicar" → FORMATO SECUENCIAL.

DISTINGUE POR INTENCIÓN (muy importante):
· "aprender" → ENSEÑA el tema en detalle: concepto, regla y un ejemplo_guiado RESUELTO paso a
  paso (explicando cada paso), y cierra con "practica".
· "practicar" → el alumno quiere EJERCICIOS para resolver ÉL MISMO. NO se lo resuelvas tú.
  Da una introducción breve y, a lo sumo, un recordatorio corto del método (SIN resolver otra
  ecuación por completo), escribe el ejercicio en la pizarra y pídele que lo resuelva. El foco
  es que el alumno trabaje, no ver la solución hecha.
  PROHIBIDO en "practicar" usar frases como "vamos a resolver", "resolvamos juntos", "te muestro
  cómo se resuelve" o mostrar la solución: el que resuelve es el ALUMNO. Redacta la introducción
  INVITÁNDOLO a resolver (p.ej. "Aquí tienes un ejercicio para que lo resuelvas tú").

FORMATO MODULAR:
Escena con "modulos": array de { "id", "directivas": [...] }. Para "aprender": módulos "concepto",
"regla", "ejemplo_guiado", "practica". Para "practicar": módulos "recordatorio" (breve) y "practica"
(el ejercicio para el alumno). El último módulo termina con la "preguntar" del ejercicio nuevo.
OBLIGATORIO en CADA módulo: la PRIMERA directiva es un "hablar" con TEXTO REAL, y CADA "pizarra"
va precedida de un "hablar" que la explica. Un módulo con "pizarra" pero sin "hablar" es un ERROR.
Ejemplo de módulo bien hecho:
{ "id": "concepto", "directivas": [
  { "tipo": "hablar", "texto": "Una ecuación es como una balanza: lo de un lado vale igual que lo del otro." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "x + 3 = 5" },
  { "tipo": "hablar", "texto": "La x es el número que no conocemos y que queremos descubrir." },
  { "tipo": "esperar", "segundos": 2 }
]}

FORMATO SECUENCIAL:
Escena con "directivas": array plano en orden. Para CADA paso: PRIMERO un "hablar" con TEXTO
REAL que explique el porqué, y LUEGO la "pizarra" con el paso. Un paso en "pizarra" sin su
"hablar" antes es un ERROR. Cierra con la "preguntar" del ejercicio nuevo.
Ejemplo bien hecho:
"directivas": [
  { "tipo": "hablar", "texto": "Vamos a resolver 2x + x = 12. Primero juntamos los términos que tienen x." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "3x = 12" },
  { "tipo": "hablar", "texto": "Ahora dividimos ambos lados entre 3 para dejar la x sola." },
  { "tipo": "pizarra", "accion": "escribir", "contenido": "x = 4" },
  { "tipo": "preguntar", "texto": "Ahora te toca a ti: ¿cuánto vale x en x + 5 = 9?", "respuesta": "4",
    "esperar_respuesta": true, "si_correcto": "felicitar", "si_incorrecto": "mostrar_otro_ejemplo" }
]

════════ LONGITUD (evita que la lección se corte) ════════
- Sé CONCISO: explicaciones de 1-2 frases, sin relleno. La lección COMPLETA debe tener a lo
  sumo ~12-14 directivas en total (contando todas). Es mejor una lección corta y COMPLETA
  (que cierre con su "preguntar") que una larga que se corte a la mitad.

════════ CUALQUIER TEMA MATEMÁTICO ════════
- Funciona para CUALQUIER tema básico (sumar, restar, multiplicar, dividir, fracciones,
  potencias, factorizar, ecuaciones, etc.). Enseña EXACTAMENTE el tema que pide el alumno.
  Si pide "sumar", enseña a sumar (NO ecuaciones). Adapta el ejemplo y la pregunta al tema.

Estructura general:
{
  "escena": "<nombre_corto_snake_case>",
  "intencion": "<la intención indicada>",
  "duracion_estimada": <segundos aproximados>,
  ("modulos": [...] si es modular, o "directivas": [...] si es secuencial)
}`;

// Compatibilidad: devuelve la instrucción de sistema estable (ya no depende de la intención).
export function buildSystemInstruction() {
  return SYSTEM_INSTRUCTION;
}

// --- Generador simulado (fallback) -----------------------------------------
// Se usa sin GEMINI_API_KEY o cuando Gemini falla, para que el prototipo funcione
// sin coste. Es TEMA-CONSCIENTE: enseña el tema que pide el alumno (sumar, restar,
// multiplicar, dividir, fracciones, ecuaciones, factorizar), no siempre ecuaciones.

// Normaliza para detectar el tema (minúsculas, sin tildes).
function normTema(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Operaciones aritméticas básicas.
const ARITMETICA = {
  suma:           { nombre: "sumar",       simbolo: "+", idea: "juntar dos cantidades en una sola", regla: "se juntan las dos cantidades y se cuenta el total", op: (a, b) => a + b, ej: [7, 5],  practica: [8, 6],
    analogia: "Imagina que tienes 3 dulces y un amigo te da 2 más. Los juntas y los cuentas todos: 3… 4, 5. ¡Tienes 5! Eso es sumar: juntar y contar todo.", ejReexp: [3, 2], practReexp: [4, 3] },
  resta:          { nombre: "restar",      simbolo: "−", idea: "quitar una cantidad de otra",       regla: "se quita la segunda cantidad de la primera y se cuenta lo que queda", op: (a, b) => a - b, ej: [13, 5], practica: [15, 7],
    analogia: "Imagina que tienes 8 galletas y te comes 3. Las quitas y cuentas hacia atrás lo que queda: 8… 7, 6, 5. Quedan 5. Restar es quitar y contar lo que sobra.", ejReexp: [8, 3], practReexp: [6, 2] },
  multiplicacion: { nombre: "multiplicar", simbolo: "×", idea: "sumar un número varias veces",      regla: "se suma el primer número tantas veces como indica el segundo", op: (a, b) => a * b, ej: [4, 3],  practica: [6, 3],
    analogia: "Piensa en bolsas iguales. 3 × 4 son 3 bolsas con 4 dulces cada una. Sumas las bolsas: 4 + 4 + 4 = 12. Multiplicar es sumar grupos iguales.", ejReexp: [3, 4], practReexp: [2, 5] },
  division:       { nombre: "dividir",     simbolo: "÷", idea: "repartir en partes iguales",        regla: "se reparte la primera cantidad en tantos grupos iguales como indica la segunda", op: (a, b) => a / b, ej: [12, 3], practica: [20, 4],
    analogia: "Imagina repartir dulces entre amigos. 12 ÷ 3 es dar 12 dulces a 3 amigos en partes iguales: a cada uno le tocan 4. Dividir es repartir por igual.", ejReexp: [12, 3], practReexp: [10, 2] },
};

function detectarTema(query) {
  const n = normTema(query);
  if (/\b(suma|sumar|sumas|sumando|adicion)\b/.test(n)) return "suma";
  if (/\b(resta|restar|restas|restando|sustraccion|sustraer)\b/.test(n)) return "resta";
  if (/\b(multiplica|multiplicar|multiplicacion|producto|tablas? de multiplicar)\b/.test(n)) return "multiplicacion";
  if (/\b(divide|dividir|division|divisiones|cociente|repartir)\b/.test(n)) return "division";
  if (/\b(fraccion|fracciones|numerador|denominador)\b/.test(n)) return "fraccion";
  if (/\b(ecuacion|ecuaciones|despejar|incognita|primer grado|lineal|lineales)\b/.test(n)) return "ecuacion";
  return null;
}

// "2 + 3", "cuánto es 7 × 8" → calcula la operación concreta.
function detectarOperacion(query) {
  const n = normTema(query).replace(/[x×]/g, "*").replace(/÷/g, "/");
  const m = n.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]), op = m[2], b = Number(m[3]);
  const apply = { "+": (x, y) => x + y, "-": (x, y) => x - y, "*": (x, y) => x * y, "/": (x, y) => (y === 0 ? NaN : x / y) }[op];
  const r = apply(a, b);
  if (!Number.isFinite(r)) return null;
  const tema = { "+": "suma", "-": "resta", "*": "multiplicacion", "/": "division" }[op];
  return { a, b, r, tema };
}

// "a² − b²", "x^2 - y^2" → factorización por diferencia de cuadrados.
function detectarDiferenciaCuadrados(query) {
  const n = normTema(query).replace(/\s+/g, "");
  const m = n.match(/([a-z])(\^2|²|2)-([a-z])(\^2|²|2)/);
  return m && m[1] !== m[3] ? { a: m[1], b: m[3] } : null;
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const preg = (texto, respuesta) => ({ tipo: "preguntar", texto, respuesta, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });

// Lección de una operación aritmética (sumar/restar/multiplicar/dividir).
// reexplain=true → NO repite la lección: la enseña de OTRA forma, con analogía y más corta.
function mockAritmetica(tema, intent, reexplain) {
  const t = ARITMETICA[tema];
  const [a, b] = t.ej, res = t.op(a, b);
  const [pa, pb] = t.practica, pres = t.op(pa, pb);
  const ejercicio = preg(`¿Cuánto es ${pa} ${t.simbolo} ${pb}? Escribe solo el número.`, fmtNum(pres));

  if (reexplain) {
    // El alumno no entendió: otra explicación, con ANALOGÍA cotidiana y un ejercicio más simple.
    const [ra, rb] = t.ejReexp, rres = t.op(ra, rb);
    const [qa, qb] = t.practReexp, qres = t.op(qa, qb);
    return { escena: `demo_${tema}_reexplica`, intencion: "explicar", duracion_estimada: 45, _mock: true, directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: "Tranquilo, ¡vamos a verlo de otra forma, más fácil y con un ejemplo de la vida real!" },
      { tipo: "hablar", texto: t.analogia },
      { tipo: "pizarra", accion: "escribir", contenido: `${ra} ${t.simbolo} ${rb} = ${fmtNum(rres)}` },
      { tipo: "hablar", texto: "¿Ves? Con algo de todos los días se entiende mejor. Probemos con números pequeños." },
      preg(`Con calma: ¿cuánto es ${qa} ${t.simbolo} ${qb}? Escribe solo el número.`, fmtNum(qres)),
    ] };
  }
  if (intent === "practicar") {
    return { escena: `demo_${tema}`, intencion: intent, duracion_estimada: 50, _mock: true, modulos: [
      { id: "recordatorio", directivas: [
        { tipo: "avatar", accion: "sonreir" },
        { tipo: "hablar", texto: `¡Vamos a practicar a ${t.nombre}! Aquí tienes un ejercicio para que lo resuelvas tú.` },
      ] },
      { id: "practica", directivas: [
        { tipo: "pizarra", accion: "escribir", contenido: `${pa} ${t.simbolo} ${pb}` },
        { tipo: "hablar", texto: "Calcula el resultado y escríbelo." },
        ejercicio,
      ] },
    ] };
  }
  // APRENDER: estructura pedagógica completa — concepto, regla, ejemplo guiado y práctica.
  return { escena: `demo_${tema}`, intencion: intent, duracion_estimada: 90, _mock: true, modulos: [
    { id: "concepto", directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: `Vamos a aprender a ${t.nombre}. ${cap(t.nombre)} es ${t.idea}.` },
    ] },
    { id: "regla", directivas: [
      { tipo: "hablar", texto: `La regla es sencilla: para ${t.nombre}, ${t.regla}.` },
    ] },
    { id: "ejemplo_guiado", directivas: [
      { tipo: "hablar", texto: `Veamos un ejemplo paso a paso: ${a} ${t.simbolo} ${b}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} ${t.simbolo} ${b}` },
      { tipo: "hablar", texto: `Aplicamos la regla: ${t.regla}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} ${t.simbolo} ${b} = ${fmtNum(res)}` },
      { tipo: "hablar", texto: `Entonces, ${a} ${t.simbolo} ${b} es igual a ${fmtNum(res)}.` },
    ] },
    { id: "practica", directivas: [
      { tipo: "hablar", texto: "Ahora te toca a ti. Resuelve este ejercicio y escribe el resultado." },
      { tipo: "pizarra", accion: "escribir", contenido: `${pa} ${t.simbolo} ${pb}` },
      ejercicio,
    ] },
  ] };
}

// Cálculo de una operación concreta ("2 + 3").
function mockOperacion({ a, b, r, tema }, intent) {
  const t = ARITMETICA[tema];
  const [pa, pb] = t.practica, pres = t.op(pa, pb);
  return { escena: "demo_operacion", intencion: intent, duracion_estimada: 40, _mock: true, directivas: [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Vamos a calcular ${fmtNum(a)} ${t.simbolo} ${fmtNum(b)}.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${fmtNum(a)} ${t.simbolo} ${fmtNum(b)} = ${fmtNum(r)}` },
    { tipo: "hablar", texto: `El resultado es ${fmtNum(r)}.` },
    preg(`Ahora tú: ¿cuánto es ${pa} ${t.simbolo} ${pb}? Escribe solo el número.`, fmtNum(pres)),
  ] };
}

// Fracciones (mismo denominador).
function mockFraccion(intent, reexplain) {
  const ejercicio = preg("¿Cuánto es 2/6 + 3/6? Escribe la fracción (por ejemplo: 5/6).", "5/6");
  if (reexplain) {
    return { escena: "demo_fraccion_reexplica", intencion: "explicar", duracion_estimada: 45, _mock: true, directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: "Tranquilo, veámoslo de otra forma: con una pizza." },
      { tipo: "hablar", texto: "Imagina una pizza cortada en 4 partes iguales; cada parte es 1/4. Si te comes 2 partes, te comiste 2/4." },
      { tipo: "pizarra", accion: "escribir", contenido: "1/4 + 1/4 = 2/4" },
      { tipo: "hablar", texto: "Con el mismo denominador solo juntas las partes de arriba (numeradores) y el de abajo se queda igual." },
      preg("¿Cuánto es 1/5 + 2/5? Escribe la fracción (por ejemplo: 3/5).", "3/5"),
    ] };
  }
  if (intent === "practicar") {
    return { escena: "demo_fraccion", intencion: intent, duracion_estimada: 50, _mock: true, modulos: [
      { id: "recordatorio", directivas: [
        { tipo: "avatar", accion: "sonreir" },
        { tipo: "hablar", texto: "¡Vamos a practicar fracciones! Con el mismo denominador se suman los numeradores. Aquí tienes tu ejercicio." },
      ] },
      { id: "practica", directivas: [
        { tipo: "pizarra", accion: "escribir", contenido: "2/6 + 3/6" },
        { tipo: "hablar", texto: "Suma los numeradores y escribe la fracción." },
        ejercicio,
      ] },
    ] };
  }
  return { escena: "demo_fraccion", intencion: intent, duracion_estimada: 80, _mock: true, modulos: [
    { id: "concepto", directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: "Una fracción representa partes de un todo: arriba el numerador, abajo el denominador." },
      { tipo: "hablar", texto: "Para sumar fracciones con el mismo denominador, se suman los numeradores y se mantiene el denominador." },
      { tipo: "pizarra", accion: "escribir", contenido: "1/5 + 3/5 = 4/5" },
      { tipo: "hablar", texto: "Así, 1/5 + 3/5 = 4/5." },
    ] },
    { id: "practica", directivas: [
      { tipo: "hablar", texto: "Ahora tú. Suma estas fracciones y escribe el resultado." },
      { tipo: "pizarra", accion: "escribir", contenido: "2/6 + 3/6" },
      ejercicio,
    ] },
  ] };
}

// Factorización por diferencia de cuadrados (a² − b²).
function mockDiferenciaCuadrados({ a, b }, intent) {
  return { escena: "demo_factorizacion", intencion: intent, duracion_estimada: 60, _mock: true, directivas: [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Vamos a factorizar ${a}² − ${b}². Es una "diferencia de cuadrados".` },
    { tipo: "pizarra", accion: "escribir", contenido: `${a}² − ${b}²` },
    { tipo: "hablar", texto: "La regla es: a² − b² = (a + b)(a − b)." },
    { tipo: "pizarra", accion: "escribir", contenido: `${a}² − ${b}² = (${a} + ${b})(${a} − ${b})` },
    { tipo: "hablar", texto: `Así, ${a}² − ${b}² se factoriza como (${a} + ${b})(${a} − ${b}).` },
    preg("Ahora tú: factoriza x² − 9. Escribe el resultado (por ejemplo: (x+3)(x−3)).", "(x+3)(x-3)"),
  ] };
}

// Ecuación lineal (tema, sin una ecuación concreta en la consulta).
function mockEcuacion(intent, reexplain) {
  const ejercicio = preg("¿Cuánto vale x en x + 7 = 12? Escribe solo el número.", "5");
  if (reexplain) {
    return { escena: "demo_ecuacion_reexplica", intencion: "explicar", duracion_estimada: 45, _mock: true, directivas: [
      { tipo: "avatar", accion: "sonreir" },
      { tipo: "hablar", texto: "Tranquilo, veámoslo de otra forma: como una balanza." },
      { tipo: "hablar", texto: "Una ecuación es una balanza en equilibrio: un lado pesa igual que el otro, y la x es un peso que no conocemos." },
      { tipo: "pizarra", accion: "escribir", contenido: "x + 3 = 5" },
      { tipo: "hablar", texto: "Si a un lado le quitamos 3, al otro también, para no romper el equilibrio. Queda x = 2." },
      { tipo: "pizarra", accion: "escribir", contenido: "x = 2" },
      preg("Ahora tú: ¿cuánto vale x en x + 4 = 6? Escribe solo el número.", "2"),
    ] };
  }
  if (intent === "practicar") {
    return { escena: "demo_practica", intencion: intent, duracion_estimada: 50, _mock: true, modulos: [
      { id: "recordatorio", directivas: [
        { tipo: "avatar", accion: "sonreir" },
        { tipo: "hablar", texto: "¡Vamos a practicar ecuaciones lineales! Recuerda: para hallar la x, se deja sola pasando los números al otro lado con la operación inversa. Aquí tienes tu ejercicio." },
      ] },
      { id: "practica", directivas: [
        { tipo: "pizarra", accion: "escribir", contenido: "x + 7 = 12" },
        { tipo: "hablar", texto: "Resuélvelo tú y escribe el valor de x." },
        ejercicio,
      ] },
    ] };
  }
  const ejemplo = solveLinearSteps("2x + 4 = 10");
  const guiado = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Vamos a ver las ecuaciones lineales. La meta es dejar la x sola en un lado del igual. Veamos un ejemplo." },
    { tipo: "pizarra", accion: "escribir", contenido: ejemplo.original },
    { tipo: "esperar", segundos: 1 },
  ];
  for (const s of ejemplo.steps) {
    guiado.push({ tipo: "hablar", texto: s.explica });
    guiado.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe });
  }
  return { escena: "demo_aprender", intencion: intent, duracion_estimada: 100, _mock: true, modulos: [
    { id: "ejemplo_guiado", directivas: guiado },
    { id: "practica", directivas: [
      { tipo: "hablar", texto: "Ahora te toca a ti. Resuelve este ejercicio y escribe el valor de x." },
      { tipo: "pizarra", accion: "escribir", contenido: "x + 7 = 12" },
      ejercicio,
    ] },
  ] };
}

// Tema no reconocido en modo demo: honesto (NO inventa contenido de otro tema).
function mockGenerico(query, intent) {
  return { escena: "demo_generico", intencion: intent, duracion_estimada: 40, _mock: true, directivas: [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Tomé nota de tu consulta: "${query}".` },
    { tipo: "pizarra", accion: "escribir", contenido: query },
    { tipo: "hablar", texto: "Ahora mismo el tutor está en modo de demostración con ejemplos básicos. Para desarrollar este tema completo, inténtalo de nuevo en un momento y el tutor con IA lo explicará paso a paso." },
    preg("Mientras tanto, ¿quieres practicar un tema básico? Escribe: sumar, restar, multiplicar, dividir o ecuaciones.", null),
  ] };
}

export function mockLSG(query, intent, opts = {}) {
  const reexplain = !!opts.reexplain; // "no entendí": enseñar de OTRA forma, no repetir

  // 1) Ecuación lineal concreta en la consulta → resolver de verdad, paso a paso.
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
    }
    directivas.push(preg(`Ahora te toca a ti: ¿cuánto vale ${solved.varName} en ${solved.varName} + 2 = 6?`, "4"));
    return { escena: "demo_resuelto", intencion: intent, duracion_estimada: 60, _mock: true, directivas };
  }

  // 2) Diferencia de cuadrados (a² − b²) → factorizar.
  const dc = detectarDiferenciaCuadrados(query);
  if (dc) return mockDiferenciaCuadrados(dc, intent);

  // 3) Operación concreta ("2 + 3") → calcular.
  const oper = detectarOperacion(query);
  if (oper) return mockOperacion(oper, intent);

  // 4) Tema reconocido → lección de ESE tema (no siempre ecuaciones).
  const tema = detectarTema(query);
  if (tema && ARITMETICA[tema]) return mockAritmetica(tema, intent, reexplain);
  if (tema === "fraccion") return mockFraccion(intent, reexplain);
  if (tema === "ecuacion") return mockEcuacion(intent, reexplain);

  // 5) Tema no reconocido → honesto (no mostrar contenido de otro tema).
  return mockGenerico(query, intent);
}
