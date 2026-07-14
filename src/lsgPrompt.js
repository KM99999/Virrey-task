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
    // Campo de RAZONAMIENTO interno (cadena de pensamiento). Va PRIMERO (ver
    // propertyOrdering) para OBLIGAR a la IA a calcular el resultado del ejercicio de
    // práctica ANTES de escribir el resto del JSON, y así fijar "respuesta" con ese valor.
    // El frontend lo ignora (no se muestra ni se habla): es control de calidad interno.
    verificacion_respuesta: { type: "string" },
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
  // El orden importa: la IA genera los campos en este orden, así el cálculo
  // (verificacion_respuesta) ocurre ANTES que la pregunta y su "respuesta".
  propertyOrdering: [
    "verificacion_respuesta", "escena", "intencion", "duracion_estimada",
    "modulos", "directivas",
  ],
  required: ["verificacion_respuesta", "escena", "intencion"],
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
- ENSEÑA COMO A ALGUIEN QUE NO SABE NADA: no asumas ningún conocimiento previo. Define cada
  término que uses, avanza MUY paso a paso, sin saltos, con detalle y con un ejemplo concreto de
  la vida real. Es mejor sobre-explicar que dejar una sola duda.
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

════════ CÁLCULO Y AUTO-VERIFICACIÓN DE LA RESPUESTA (OBLIGATORIO, lo más crítico) ════════
La respuesta correcta debe ser CORRECTA sea cual sea la redacción (ecuación, problema verbal,
velocidad, área, división, fracciones, lo que sea). Reglas ESTRICTAS:
1) RAZONA PRIMERO (cadena de pensamiento) en el campo "verificacion_respuesta", que es tu
   BORRADOR PRIVADO (el alumno NUNCA lo ve). Ahí, ANTES de escribir el resto del JSON, resuelve
   TÚ MISMO paso a paso el ejercicio de práctica que vas a proponer y obtén su resultado exacto.
   TERMINA SIEMPRE ese campo con una línea "Resultado: <valor>" (solo el número o fracción, con
   unidad opcional). Ejemplo: "Ejercicio: 50 m en 5 s → velocidad = distancia/tiempo. Cálculo:
   50 ÷ 5 = 10. Resultado: 10".
2) VALIDACIÓN ESTRICTA: el campo "respuesta" de la "preguntar" debe ser EXACTAMENTE ese Resultado
   (solo el número/fracción, corto, p.ej. "10"). Verifica que coincida con la operación planteada.
   La respuesta es el RESULTADO de la operación, NUNCA un dato del enunciado (distancia, tiempo,
   precio) ni la copiada de un ejemplo. Ej.: "200 m en 25 s, ¿velocidad?" → respuesta 8, JAMÁS 200.
3) MISMOS NÚMEROS: el ejercicio de la pregunta debe usar EXACTAMENTE los mismos números que
   resolviste en "verificacion_respuesta", y su respuesta es ese Resultado. NO uses los números
   del ejemplo que enseñaste (el de práctica es DISTINTO). Ej.: si en clase mostraste 5×3=15, la
   práctica NO puede ser 5×3; propón p.ej. 7×4 y su respuesta es 28, no 15.
4) SEPARACIÓN ESTRICTA: la respuesta va SOLO en el campo "respuesta". PROHIBIDO escribir la
   respuesta, "Respuesta: …", pistas, ejemplos o el cálculo DENTRO del texto de la "preguntar".
   El texto de la pregunta es UNA SOLA FRASE corta (máx. ~15 palabras) que termina en "?", con el
   enunciado del ejercicio y NADA más: sin "por ejemplo", sin saludos, sin ánimos, sin revelar el
   resultado. Toda tu aritmética va en "verificacion_respuesta", nunca en la pregunta.

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
- Incluye SIEMPRE el campo "respuesta" con la respuesta del NUEVO ejercicio, corta (p.ej. "4"
  o "1/2" para fracciones). Es obligatorio para poder calificar. DEBE ser EXACTAMENTE el resultado
  que calculaste en "verificacion_respuesta" (ver sección de AUTO-VERIFICACIÓN).
- La pregunta debe ser CORTA y directa: UNA sola frase con el ejercicio (máx. ~15 palabras).
  NO metas instrucciones largas, opciones, ni ejemplos dentro de la pregunta, ni la repitas.
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

════════ MÁS EJEMPLOS DE BUENAS LECCIONES ════════
Ejemplo (división, "resuelve 12 ÷ 4"):
  { "tipo": "hablar", "texto": "Dividir es repartir en partes iguales. Repartamos 12 entre 4." }
  { "tipo": "pizarra", "accion": "escribir", "contenido": "12 ÷ 4" }
  { "tipo": "hablar", "texto": "Buscamos qué número por 4 da 12. Es 3, porque 3 × 4 = 12." }
  { "tipo": "pizarra", "accion": "escribir", "contenido": "12 ÷ 4 = 3" }
  { "tipo": "preguntar", "texto": "¿Cuánto es 20 ÷ 5?", "respuesta": "4", "esperar_respuesta": true, "si_correcto": "felicitar", "si_incorrecto": "mostrar_otro_ejemplo" }
Ejemplo (fracciones, aprender): módulo "concepto" ("Una fracción son partes de un todo: arriba el
numerador, abajo el denominador"); "regla" ("Con el mismo denominador, se suman los numeradores y el
denominador se mantiene"); "ejemplo_guiado" (hablar "1/4 + 2/4: sumamos 1+2=3 y dejamos el 4" → pizarra
"1/4 + 2/4 = 3/4"); "practica" (preguntar "¿Cuánto es 2/5 + 1/5?" con respuesta "3/5").
Ejemplo (potencias): "2³ significa 2 × 2 × 2 = 8. El número pequeño, el exponente, dice cuántas veces se
multiplica la base por sí misma." Ejemplo (derivadas, potencias): "La derivada de xⁿ es n·xⁿ⁻¹: se baja
el exponente como coeficiente y se le resta 1. Así, la derivada de x³ es 3x²."
TONO Y ACTITUD: cálido y cercano, como un buen profesor paciente con un alumno que empieza de cero.
Anima ("¡vas muy bien!", "¡tú puedes!") sin exagerar, usa palabras sencillas, no des por sabido NADA,
define cada término la primera vez que aparece, y cierra SIEMPRE comprobando la comprensión con la pregunta.

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
  const raw = normTema(query);
  // Si hay exponentes o potencias (x², x^2, x³) es ÁLGEBRA, no una operación simple:
  // evita leer "x^2 - 9" como "2 - 9". Eso lo maneja la diferencia de cuadrados.
  if (/[\^²³]/.test(raw)) return null;
  const n = raw.replace(/[x×]/g, "*").replace(/÷/g, "/");
  const m = n.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]), op = m[2], b = Number(m[3]);
  const apply = { "+": (x, y) => x + y, "-": (x, y) => x - y, "*": (x, y) => x * y, "/": (x, y) => (y === 0 ? NaN : x / y) }[op];
  const r = apply(a, b);
  if (!Number.isFinite(r)) return null;
  const tema = { "+": "suma", "-": "resta", "*": "multiplicacion", "/": "division" }[op];
  return { a, b, r, tema };
}

// Diferencia de cuadrados: "a² − b²" (dos variables) o "x² − 9" (variable² − cuadrado perfecto).
// Acepta notación ² y ^2. Ej.: x² − 9 = (x+3)(x−3).
function detectarDiferenciaCuadrados(query) {
  const n = normTema(query).replace(/\s+/g, "").replace(/\^2/g, "²");
  // caso 1: variable² − variable²  (a² − b²)
  let m = n.match(/([a-z])²-([a-z])²/);
  if (m && m[1] !== m[2]) return { tipo: "vars", a: m[1], b: m[2] };
  // caso 2: variable² − número, si el número es un cuadrado perfecto (x² − 9 → raíz 3)
  m = n.match(/([a-z])²-(\d+)/);
  if (m) {
    const raiz = Math.sqrt(Number(m[2]));
    if (Number.isInteger(raiz) && raiz > 0) return { tipo: "num", v: m[1], n: Number(m[2]), raiz };
  }
  return null;
}

const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const preg = (texto, respuesta) => ({ tipo: "preguntar", texto, respuesta, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
const countUp = (from, to) => { const r = []; for (let i = from; i <= to; i++) r.push(i); return r; };
const countDown = (from, to) => { const r = []; for (let i = from; i >= to; i--) r.push(i); return r; };
const nombreTema = { suma: "la suma", resta: "la resta", multiplicacion: "la multiplicación", division: "la división" };

// RE-ENSEÑANZA PROFUNDA (para "no entendí"): enseña la operación DESDE CERO, paso a paso,
// como a quien no sabe nada — con analogía cotidiana, contando uno por uno y definiendo el
// signo. Distinta de la primera lección (otro enfoque), pero MÁS detallada, no más breve.
function mockAritmeticaReexplica(tema) {
  const t = ARITMETICA[tema];
  const [a, b] = t.ejReexp, res = t.op(a, b);
  const [qa, qb] = t.practReexp, qres = t.op(qa, qb);

  const cabecera = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Tranquilo, no te preocupes. Vamos a entender ${nombreTema[tema]} desde cero, con mucha calma y con un ejemplo de la vida real.` },
  ];

  let cuerpo = [];
  if (tema === "suma") {
    cuerpo = [
      { tipo: "hablar", texto: "Sumar significa JUNTAR. Si tienes dos grupos de cosas y los cuentas todos juntos, eso es sumar." },
      { tipo: "hablar", texto: `Imagina que en una mano tienes ${a} dulces.` },
      { tipo: "pizarra", accion: "escribir", contenido: `Primera mano: ${a} dulces` },
      { tipo: "hablar", texto: `Y en la otra mano tienes ${b} dulces más.` },
      { tipo: "pizarra", accion: "escribir", contenido: `Segunda mano: ${b} dulces` },
      { tipo: "hablar", texto: "Para sumar, juntamos todos los dulces y los contamos uno por uno, sin saltarnos ninguno." },
      { tipo: "hablar", texto: `Contamos los de la primera mano: ${countUp(1, a).join(", ")}. Y seguimos con los de la otra: ${countUp(a + 1, a + b).join(", ")}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${countUp(1, a + b).join(", ")}  →  en total ${res}` },
      { tipo: "hablar", texto: `Contamos ${res} dulces en total. El signo + significa "juntar", así que esto se escribe:` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} + ${b} = ${res}` },
    ];
  } else if (tema === "resta") {
    cuerpo = [
      { tipo: "hablar", texto: "Restar significa QUITAR. Si tienes cosas y quitas algunas, al final te quedan MENOS." },
      { tipo: "hablar", texto: `Imagina que tienes ${a} galletas sobre la mesa.` },
      { tipo: "pizarra", accion: "escribir", contenido: `Tienes: ${a} galletas` },
      { tipo: "hablar", texto: `Ahora te comes ${b} galletas. Vamos a quitarlas UNA POR UNA, contando hacia atrás.` },
      { tipo: "hablar", texto: `Empezamos en ${a} y bajamos ${b} veces: ${countDown(a, a - b).join(", ")}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${countDown(a, a - b).join(" → ")}` },
      { tipo: "hablar", texto: `Nos quedamos en ${res}. El signo − significa "quitar", así que esto se escribe:` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} − ${b} = ${res}` },
    ];
  } else if (tema === "multiplicacion") {
    cuerpo = [
      { tipo: "hablar", texto: "Multiplicar es una forma rápida de SUMAR grupos iguales." },
      { tipo: "hablar", texto: `${a} × ${b} significa "${a} grupos de ${b}". Imagina ${a} bolsas, y en cada bolsa hay ${b} dulces.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} bolsas · ${b} dulces en cada una` },
      { tipo: "hablar", texto: `Para saber el total, sumamos ${b} tantas veces como bolsas hay (${a} veces):` },
      { tipo: "pizarra", accion: "escribir", contenido: `${Array(a).fill(b).join(" + ")} = ${res}` },
      { tipo: "hablar", texto: `Son ${res} dulces en total. El signo × significa "veces", así que:` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} × ${b} = ${res}` },
    ];
  } else {
    cuerpo = [
      { tipo: "hablar", texto: "Dividir es REPARTIR en partes iguales, para que a todos les toque lo mismo." },
      { tipo: "hablar", texto: `${a} ÷ ${b} significa "repartir ${a} entre ${b}". Imagina ${a} dulces y ${b} amigos.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} dulces para ${b} amigos` },
      { tipo: "hablar", texto: "Repartimos de a uno, dando la vuelta a cada amigo, hasta que se acaben los dulces." },
      { tipo: "hablar", texto: `Al final, a cada amigo le toca la misma cantidad: ${res}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `A cada uno le tocan ${res}` },
      { tipo: "hablar", texto: `El signo ÷ significa "repartir por igual", así que:` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a} ÷ ${b} = ${res}` },
    ];
  }

  const cierre = [
    { tipo: "hablar", texto: "¡Lo estás haciendo muy bien! Ahora inténtalo tú, con toda calma. Puedes contar con los dedos si te ayuda." },
    { tipo: "pizarra", accion: "escribir", contenido: `${qa} ${t.simbolo} ${qb} = ?` },
    preg(`Con calma: ¿cuánto es ${qa} ${t.simbolo} ${qb}? Escribe solo el número.`, fmtNum(qres)),
  ];

  return { escena: `demo_${tema}_reexplica`, intencion: "explicar", duracion_estimada: 90, _mock: true, directivas: [...cabecera, ...cuerpo, ...cierre] };
}

// Lección de una operación aritmética (sumar/restar/multiplicar/dividir).
// reexplain=true → NO repite la lección: la enseña de OTRA forma, con analogía y más corta.
function mockAritmetica(tema, intent, reexplain) {
  const t = ARITMETICA[tema];
  const [a, b] = t.ej, res = t.op(a, b);
  const [pa, pb] = t.practica, pres = t.op(pa, pb);
  const ejercicio = preg(`¿Cuánto es ${pa} ${t.simbolo} ${pb}? Escribe solo el número.`, fmtNum(pres));

  // El alumno no entendió → re-enseñanza PROFUNDA, desde cero, paso a paso.
  if (reexplain) return mockAritmeticaReexplica(tema);
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

// Factorización por diferencia de cuadrados: a² − b² (dos variables) o x² − 9 (variable − número).
function mockDiferenciaCuadrados(d, intent) {
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  if (d.tipo === "vars") {
    const { a, b } = d;
    dir.push(
      { tipo: "hablar", texto: `Vamos a factorizar ${a}² − ${b}². Es una "diferencia de cuadrados": un cuadrado menos otro cuadrado.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${a}² − ${b}²` },
      { tipo: "hablar", texto: "La regla es: a² − b² = (a + b)(a − b). Se abre en dos paréntesis: uno con + y otro con −." },
      { tipo: "pizarra", accion: "escribir", contenido: `${a}² − ${b}² = (${a} + ${b})(${a} − ${b})` },
      { tipo: "hablar", texto: `Así, ${a}² − ${b}² se factoriza como (${a} + ${b})(${a} − ${b}).` },
      preg("Ahora tú: factoriza x² − 4. Escribe el resultado (por ejemplo: (x+2)(x−2)).", "(x+2)(x-2)"),
    );
  } else {
    const { v, n, raiz } = d;
    dir.push(
      { tipo: "hablar", texto: `Vamos a factorizar ${v}² − ${n}. Es una "diferencia de cuadrados", porque ${n} es ${raiz} al cuadrado (${raiz} × ${raiz} = ${n}).` },
      { tipo: "pizarra", accion: "escribir", contenido: `${v}² − ${n}   (o sea ${v}² − ${raiz}²)` },
      { tipo: "hablar", texto: `La regla es: a² − b² = (a + b)(a − b). Aquí "a" es ${v} y "b" es ${raiz}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${v}² − ${n} = (${v} + ${raiz})(${v} − ${raiz})` },
      { tipo: "hablar", texto: `Por eso ${v}² − ${n} se factoriza como (${v} + ${raiz})(${v} − ${raiz}).` },
      preg(`Ahora tú: factoriza ${v}² − 4. Escribe el resultado (por ejemplo: (${v}+2)(${v}−2)).`, `(${v}+2)(${v}-2)`),
    );
  }
  return { escena: "demo_factorizacion", intencion: intent, duracion_estimada: 70, _mock: true, directivas: dir };
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
