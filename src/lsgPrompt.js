// Definición del LSG (Learning Scene Graph) y el prompt que fuerza a la IA a
// devolverlo. El LSG es la salida estructurada que el PRE Light valida y que en
// la Fase 2 el PSE Light reproducirá sincronizando voz + revelación visual.

import { solveLinearSteps, computeDerivative, computeFactorization, monomioLimpio } from "./preLight.js";
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
- ARITMÉTICA CONSISTENTE ENTRE PASOS (CRÍTICO al resolver): cada línea de la pizarra debe deducirse
  EXACTAMENTE de la anterior. NUNCA introduzcas un número que no venga de la línea previa. Cuando
  operes lo MISMO en ambos lados de una ecuación, el otro lado debe usar el número REAL de la línea
  anterior. Ej. correcto para "5x - 3 = 12": "5x - 3 + 3 = 12 + 3" → "5x = 15" (12 viene del paso
  previo). ERROR GRAVE: escribir "5x - 3 + 3 = 6 + 3" (el 6 NO aparece antes; sale de la nada).
  Además, TODAS las ecuaciones intermedias deben tener la MISMA solución que la original (si la
  original es 5x-3=12 con x=3, cada paso debe seguir dando x=3). Verifica cada igualdad antes de
  escribirla; comprueba el resultado final sustituyéndolo en la ecuación original.
- FRACCIÓN → DECIMAL (CRÍTICO): para convertir a/b en decimal se divide el NUMERADOR entre el
  DENOMINADOR, nunca la fracción entera. Correcto: "1/2 = 1 ÷ 2 = 0.5". ERROR GRAVE: "1/2 = 1/2 ÷ 2 = 0.5"
  (repetir la fracción divide de más y da 0.25, no 0.5). En una cadena "A = B = C" TODOS los términos
  deben valer EXACTAMENTE lo mismo; verifica cada uno antes de escribirlo.
- PRÁCTICA CON NÚMEROS DISTINTOS: el ejercicio de práctica ("ahora te toca a ti") debe usar números
  DIFERENTES a los del ejemplo guiado. ERROR GRAVE: resolver "2/5 + 1/5 = 3/5" en el ejemplo y luego
  pedir de práctica "2/5 + 1/5" (revela la respuesta). Cambia los números (p.ej. "1/4 + 2/4").
- PIZARRA LIMPIA (una idea por línea): NO pegues la expresión con las sustituciones ni encadenes
  asignaciones sin comas. Al identificar variables (p.ej. diferencia de cuadrados) escríbelo claro y
  SEPARADO: "a = x, b = 3" (con coma). ERROR GRAVE: "x² - 9 a = x b = 3" (se lee como "x²-9a = x·b = 3",
  confuso). Cada pizarra debe ser una expresión o igualdad legible por sí sola.
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
- EJERCICIO SIMPLE Y LIMPIO: el ejercicio de práctica debe ser SENCILLO y estar bien formado.
  PROHIBIDO usar como ejercicio un PASO INTERMEDIO del cálculo o una expresión garabateada
  (p. ej. "f'(x) ≈ 3·(2x²⁻¹)"). En derivadas, plantea una potencia simple y limpia, del tipo
  "¿Cuál es la derivada de x⁴?" (o "de 2x³"), NUNCA una expresión a medio resolver ni con f'(x).
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
  // Solo ecuaciones de PRIMER GRADO. "cuadráticas/segundo grado/cúbicas/polinómicas" NO son "ecuacion"
  // lineal → cae a mockGenerico (mensaje honesto "la IA lo explicará"), nunca una lección lineal falsa.
  if (/\b(ecuacion|ecuaciones|despejar|incognita|primer grado|lineal|lineales)\b/.test(n)
    && !/cuadrat|segundo grado|c[uú]bic|bicuadr|polinom|tercer grado/.test(n)) return "ecuacion";
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

// EJERCICIO DE FRACCIONES: (1) FORMULA una suma de fracciones y la RESUELVE paso a paso (el sistema
// encuentra la solución), y (2) plantea DESPUÉS un problema de PRÁCTICA con OTRA fracción DISTINTA para
// que el ALUMNO lo responda (calificable: correcto → lección completada; incorrecto → pista + reintento).
// Rota por una lista para que cada "otro ejemplo" (se pasa la fracción resuelta anterior en `evitar`)
// presente un resuelto y una práctica NUEVOS. Aritmética garantizada (no depende del modelo).
// FÁCIL/NORMAL: mismo denominador (se suman los numeradores). DIFÍCIL: denominadores DISTINTOS, que
// obliga a buscar el mínimo común denominador y convertir ambas fracciones antes de sumar.
//   [n1, n2, den]      → n1/den + n2/den            (mismo denominador)
//   [n1, d1, n2, d2]   → n1/d1  + n2/d2             (denominadores distintos)
const FRACCIONES = {
  facil: [[1, 2, 4], [1, 3, 5], [2, 3, 6], [1, 5, 7], [1, 2, 8], [2, 3, 8]],
  normal: [[2, 3, 6], [1, 2, 4], [1, 3, 5], [2, 5, 8], [3, 4, 9], [1, 4, 7], [2, 3, 10], [1, 5, 11]],
  dificil: [[1, 2, 1, 3], [1, 4, 1, 6], [2, 3, 1, 4], [3, 5, 1, 2], [1, 3, 2, 5], [3, 4, 1, 6]],
};
const textoFrac = (e) => (e.length === 3 ? `${e[0]}/${e[2]} + ${e[1]}/${e[2]}` : `${e[0]}/${e[1]} + ${e[2]}/${e[3]}`);
// Acepta un string (compatibilidad: `fraccionResueltaLSG(evitar)`) o { evitar, nivel }.
export function fraccionResueltaLSG(opts) {
  const o = typeof opts === "string" ? { evitar: opts } : (opts || {});
  const nivel = NIVELES.includes(o.nivel) ? o.nivel : "normal";
  const evitar = typeof o.evitar === "string" ? o.evitar : "";
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
  const fmt = (n, d) => (d === 1 ? String(n) : `${n}/${d}`);
  // Mismo denominador: se suman numeradores y se simplifica.
  const mismoDen = (e) => {
    const [n1, n2, d] = e, s = n1 + n2, g = gcd(s, d);
    return { texto: textoFrac(e), n1, n2, d, suma: s, g, final: fmt(s / g, d / g), simp: g > 1 ? fmt(s / g, d / g) : null };
  };
  // Distinto denominador: mínimo común múltiplo, se convierte cada fracción y se suma.
  const distintoDen = (e) => {
    const [n1, d1, n2, d2] = e;
    const L = (d1 * d2) / gcd(d1, d2);
    const a = n1 * (L / d1), b = n2 * (L / d2), s = a + b, g = gcd(s, L);
    return { texto: textoFrac(e), n1, d1, n2, d2, L, a, b, suma: s, g, final: fmt(s / g, L / g), simp: g > 1 ? fmt(s / g, L / g) : null };
  };
  const lista = FRACCIONES[nivel];
  // INSTANCIA concreta: si el alumno escribió una suma ("5/8 + 2/8" → [5,2,8], o "1/2 + 1/3" → [1,2,1,3]),
  // se resuelve ESA como ejemplo (paridad con los otros 3 temas, que sí resuelven lo que el alumno escribe);
  // la PRÁCTICA sale de los presets del mismo tipo (mismo/distinto denominador), distinta del ejemplo.
  const inst = Array.isArray(o.instancia) && (o.instancia.length === 3 || o.instancia.length === 4) ? o.instancia : null;
  const dificil = inst ? inst.length === 4 : nivel === "dificil";
  // Rota a la SIGUIENTE tras la ya mostrada; la práctica usa la siguiente (siempre distinta).
  const hay = canonExpr(evitar);
  let last = -1;
  for (let i = 0; i < lista.length; i++) if (hay.includes(canonExpr(textoFrac(lista[i])))) last = i;
  let eA, eB;
  if (inst) {
    eA = inst;
    const pool = (dificil ? FRACCIONES.dificil : FRACCIONES.normal).filter((e) => canonExpr(textoFrac(e)) !== canonExpr(textoFrac(inst)));
    eB = pool[0];
  } else {
    eA = lista[(last + 1) % lista.length];
    eB = lista[(last + 2) % lista.length];
  }
  const A = dificil ? distintoDen(eA) : mismoDen(eA);
  const B = dificil ? distintoDen(eB) : mismoDen(eB);

  if (o.practica) return practicaLSG("fraccion_resuelta", {
    recordatorio: dificil
      ? "Recuerda: si los denominadores son DISTINTOS, primero iguálalos (busca el mínimo común denominador), convierte cada fracción y luego suma los numeradores; al final, simplifica."
      : "Recuerda: con el MISMO denominador, suma los numeradores y deja el denominador igual; luego simplifica si se puede.",
    reto1: A.texto, preg: `¿Cuánto es ${A.texto}? Escríbelo en su forma más simple.`, resp: A.final, reto2: B.texto,
  });
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  // ENSEÑAR el tema ("enséñame fracciones"): primero el CONCEPTO (qué es una fracción) y la REGLA,
  // igual que en los otros temas, para no saltar directo al ejercicio (paridad con lineal/derivadas/factoriz.).
  if (o.concepto) {
    dir.push({ tipo: "hablar", texto: "Una fracción representa partes de un todo: el número de arriba es el numerador (las partes que tomamos) y el de abajo es el denominador (en cuántas partes iguales se divide el todo)." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Fracción:  numerador / denominador" });
    // El cliente pidió el CONCEPTO de fracciones y solo se explicaba la fórmula (la suma). Aquí se enseña
    // QUÉ ES una fracción con un ejemplo concreto (una pizza en partes), el significado de numerador y
    // denominador, y fracciones EQUIVALENTES (2/4 = 1/2), ANTES de pasar a operar con ellas.
    dir.push({ tipo: "hablar", texto: "Por ejemplo, si partes una pizza en 4 porciones iguales y tomas 1, eso es 1/4: el 4 (denominador) dice en cuántas partes se dividió, y el 1 (numerador) cuántas tomaste. Si tomas 2 de esas 4, es 2/4, que es lo mismo que la mitad, 1/2." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "1/4 = una de 4 partes iguales    ·    2/4 = 1/2 (la mitad)" });
    dir.push({ tipo: "hablar", texto: "Cuanto MÁS grande es el denominador, en más partes se divide el todo y más pequeña es cada parte: 1/8 es más chico que 1/4. Con la idea clara, veamos cómo se OPERA con fracciones: para SUMARLAS con el mismo denominador, se suman los numeradores y se mantiene el denominador; si son distintos, primero se igualan. Veámoslo con un ejemplo." });
  }
  if (!dificil) {
    dir.push(
      { tipo: "hablar", texto: `Vamos a resolver juntos esta suma de fracciones: ${A.texto}. Fíjate que las dos tienen el mismo número de abajo, el denominador ${A.d}.` },
      { tipo: "pizarra", accion: "escribir", contenido: A.texto },
      { tipo: "esperar", segundos: 1 },
      { tipo: "hablar", texto: `Con el mismo denominador, solo se suman los números de arriba (los numeradores): ${A.n1} + ${A.n2} = ${A.suma}. El denominador ${A.d} se queda igual.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${A.texto} = (${A.n1} + ${A.n2})/${A.d} = ${A.suma}/${A.d}` },
      { tipo: "esperar", segundos: 1 },
    );
    if (A.simp) {
      dir.push({ tipo: "hablar", texto: `Y se puede simplificar: ${A.suma} y ${A.d} se dividen entre ${A.g}, así que ${A.suma}/${A.d} = ${A.simp}.` });
      dir.push({ tipo: "pizarra", accion: "escribir", contenido: `${A.suma}/${A.d} = ${A.simp}` });
    }
  } else {
    dir.push(
      { tipo: "hablar", texto: `Vamos a resolver ${A.texto}. Aquí los denominadores son DISTINTOS (${A.d1} y ${A.d2}), así que no podemos sumar todavía: primero hay que igualarlos.` },
      { tipo: "pizarra", accion: "escribir", contenido: A.texto },
      { tipo: "esperar", segundos: 1 },
      { tipo: "hablar", texto: `Buscamos el mínimo común denominador de ${A.d1} y ${A.d2}: es ${A.L}. Convertimos cada fracción a denominador ${A.L} multiplicando arriba y abajo por lo mismo.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${A.n1}/${A.d1} = ${A.a}/${A.L}` },
      { tipo: "pizarra", accion: "escribir", contenido: `${A.n2}/${A.d2} = ${A.b}/${A.L}` },
      { tipo: "esperar", segundos: 1 },
      { tipo: "hablar", texto: `Ahora que las dos tienen el mismo denominador, sumamos los numeradores: ${A.a} + ${A.b} = ${A.suma}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${A.a}/${A.L} + ${A.b}/${A.L} = ${A.suma}/${A.L}` },
    );
    if (A.simp) {
      dir.push({ tipo: "hablar", texto: `Y se simplifica: ${A.suma} y ${A.L} se dividen entre ${A.g}, así que ${A.suma}/${A.L} = ${A.simp}.` });
      dir.push({ tipo: "pizarra", accion: "escribir", contenido: `${A.suma}/${A.L} = ${A.simp}` });
    }
  }
  dir.push({ tipo: "hablar", texto: `¡Y listo! ${A.texto} = ${A.final}. Ahora te toca a ti con otra suma parecida.` });
  // PRÁCTICA: otra fracción DISTINTA que resuelve el alumno (calificable).
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: `${B.texto} = ?` });
  dir.push({ tipo: "preguntar", texto: `¿Cuánto es ${B.texto}? Escríbelo en su forma más simple.`, respuesta: B.final, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena: "fraccion_resuelta", intencion: o.concepto ? "aprender" : "resolver", duracion_estimada: 60, _mock: true, directivas: dir };
}

// ════════ LECCIONES DE BOTÓN DETERMINISTAS (los 4 chips de "Tu consulta") ════════
// Los cuatro botones (ecuación lineal, derivadas, factorización, fracciones) comparten AHORA
// EXACTAMENTE el mismo flujo, cada uno con su propio generador AISLADO (aritmética garantizada,
// 0 coste de IA): (1) un EJEMPLO resuelto paso a paso explicando el porqué; (2) una PRÁCTICA
// DISTINTA y calificable para que el alumno la responda. Al pedir "otro ejemplo" se rota a un
// ejemplo/práctica NUEVOS (evitando el anterior). Al ser funciones separadas, tocar una NO afecta
// a las otras (antes compartían los "fixers" heurísticos de processLSG y por eso se estorbaban).
const ESCENAS_BOTON = new Set(["lineal_resuelta", "derivada_resuelta", "factorizacion_resuelta", "fraccion_resuelta", "suma_resuelta", "resta_resuelta", "multiplicacion_resuelta", "division_resuelta"]);
export function esEscenaBoton(escena) { return ESCENAS_BOTON.has(escena); }

const normBoton = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Forma compacta y comparable de una expresión (sin espacios, superíndices → ^n) para rotar sin repetir.
const canonExpr = (s) => String(s || "").toLowerCase()
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => "^" + "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c))
  .replace(/\s+/g, "");
// Rota una lista buscando el índice MÁS ALTO cuya forma canónica aparece en `evitarRaw` (lo ya
// mostrado, p.ej. el resumen de la lección previa) y devuelve los índices del EJEMPLO (idx+1) y la
// PRÁCTICA (idx+2). Si no encuentra nada, empieza en 0/1. Así cada "otro ejemplo" avanza sin repetir.
function rotarBoton(lista, evitarRaw) {
  const hay = canonExpr(evitarRaw);
  let last = -1;
  for (let i = 0; i < lista.length; i++) {
    // Coincidencia con FRONTERA (no subcadena): así "x^3" NO casa dentro de "2x^3" (antes eso hacía que
    // la rotación "volviera al principio" y repitiera el mismo ejemplo). El token no puede ir precedido
    // ni seguido de un dígito o letra.
    const t = canonExpr(lista[i]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (t && new RegExp(`(^|[^0-9a-z])${t}([^0-9a-z]|$)`, "i").test(hay)) last = i;
  }
  const n = lista.length;
  return { ejemplo: lista[(last + 1) % n], practica: lista[(last + 2) % n] };
}
// NIVELES de dificultad. Cada tema tiene TRES listas reales (fácil / normal / difícil), no una sola:
// al pedir "algo más difícil" el ejercicio debe ser DE VERDAD más difícil (antes se caía siempre en la
// misma lista trivial —"2x = 6"— y pedir "más difícil" devolvía un ejercicio MÁS FÁCIL que el ejemplo).
const NIVELES = ["facil", "normal", "dificil"];
const listaNivel = (listas, nivel) => listas[NIVELES.includes(nivel) ? nivel : "normal"];

// Elige ejemplo + práctica DENTRO del nivel pedido: en la PRIMERA pulsación (sin seguimiento) usa la
// instancia dada por el botón (o el primer elemento) y una práctica distinta; en un seguimiento
// ("otro ejemplo", "más fácil", "más difícil") rota dentro de la lista de ESE nivel con `evitar`.
function elegirBoton(listas, { evitar, instancia, seguimiento, nivel } = {}) {
  const lista = listaNivel(listas, nivel);
  if (!seguimiento && instancia) {
    // La práctica debe ser DISTINTA del ejemplo y VARIAR según la instancia. Antes se tomaba SIEMPRE el
    // primer preset (find → lista[0]), así que consultas concretas distintas ("resuelve 3x-7=8",
    // "resuelve 2x+3=8"; "deriva x⁵", "deriva 7x³") daban SIEMPRE la misma práctica ("2x + 5 = 15" / "x²"):
    // repetitiva y con dificultad descolgada del ejemplo. Ahora se elige de forma determinista según la
    // instancia (misma consulta → misma práctica; consultas distintas → prácticas distintas).
    const pool = lista.filter((x) => canonExpr(x) !== canonExpr(instancia));
    const cands = pool.length ? pool : lista;
    const h = canonExpr(instancia).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return { ejemplo: instancia, practica: cands[h % cands.length] };
  }
  if (!seguimiento) return { ejemplo: lista[0], practica: lista[1] };
  return rotarBoton(lista, evitar);
}

// ── PRACTICAR: el alumno pide EJERCICIOS para resolverlos ÉL MISMO (no que se los resuelvan ni que le
// re-expliquen el concepto). Queja del cliente: "pido ejercicios para yo resolverlos y me sigue enseñando".
// Presenta 2 retos SIN resolverlos, con un breve recordatorio del método, y CALIFICA el primero (el
// segundo queda como reto extra). Si el alumno se traba, puede pedir "resuélvelo" y pasa a modo resolver.
// Cada generador núcleo delega aquí cuando opts.practica es true (misma "escena confiable" → PRE Light la
// respeta). La intención resultante es "practicar" (una de las 4 del acuerdo), no "resolver".
function practicaLSG(escena, { recordatorio, reto1, preg: pregTxt, resp, reto2 }) {
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "¡A practicar! Estos ejercicios son para que los resuelvas TÚ. Tómate tu tiempo y escribe tu respuesta abajo; si te trabas, dime «resuélvelo» y lo hacemos juntos." },
  ];
  if (recordatorio) dir.push({ tipo: "hablar", texto: recordatorio });
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: `Ejercicio 1:  ${reto1}` });
  if (reto2) dir.push({ tipo: "pizarra", accion: "escribir", contenido: `Ejercicio 2 (extra):  ${reto2}` });
  dir.push({ tipo: "hablar", texto: "Empieza por el Ejercicio 1 y escribe tu respuesta." });
  dir.push({ tipo: "preguntar", texto: pregTxt, respuesta: String(resp), esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena, intencion: "practicar", duracion_estimada: 45, _mock: true, directivas: dir };
}

// ════════ ARITMÉTICA BÁSICA: suma, resta, multiplicación, división (pedida por el cliente) ════════
// Mismo patrón EXACTO que los otros 4 temas: CONCEPTO primero (qué significa la operación) + ejemplo
// resuelto paso a paso + PRÁCTICA calificable, con niveles fácil/normal/difícil y rotación en "otro
// ejemplo". Determinista (0 coste de IA, siempre correcto). Antes "enséñame a sumar" caía a Gemini, que
// lo interpretaba como "sumar fracciones" — queja del cliente.
const SUMAS = {
  facil: ["3 + 4", "5 + 2", "6 + 3", "4 + 5", "7 + 2", "2 + 6", "8 + 1", "5 + 4"],
  normal: ["24 + 17", "36 + 28", "47 + 25", "58 + 36", "19 + 45", "27 + 38", "46 + 29", "53 + 19"],
  dificil: ["234 + 178", "356 + 267", "489 + 255", "678 + 145", "527 + 398", "349 + 276"],
};
const RESTAS = {
  facil: ["8 - 3", "9 - 5", "7 - 2", "6 - 4", "9 - 6", "8 - 5", "7 - 3", "9 - 4"],
  normal: ["52 - 27", "63 - 28", "71 - 35", "84 - 46", "45 - 19", "62 - 38", "90 - 47", "73 - 58"],
  dificil: ["503 - 278", "412 - 255", "600 - 347", "725 - 486", "834 - 567", "701 - 289"],
};
const MULTIS = {
  facil: ["6 × 7", "8 × 4", "7 × 3", "9 × 6", "5 × 8", "4 × 9", "7 × 8", "6 × 9"],
  normal: ["12 × 4", "13 × 6", "24 × 3", "15 × 7", "23 × 4", "18 × 5", "14 × 6", "27 × 3"],
  dificil: ["23 × 14", "34 × 12", "26 × 15", "45 × 13", "18 × 24", "32 × 16"],
};
const DIVIS = {
  facil: ["20 ÷ 4", "18 ÷ 3", "24 ÷ 6", "15 ÷ 5", "28 ÷ 7", "16 ÷ 4", "21 ÷ 3", "30 ÷ 5"],
  normal: ["84 ÷ 4", "96 ÷ 6", "72 ÷ 3", "91 ÷ 7", "85 ÷ 5", "78 ÷ 6", "98 ÷ 7", "96 ÷ 8"],
  dificil: ["144 ÷ 12", "156 ÷ 13", "288 ÷ 24", "192 ÷ 16", "225 ÷ 15", "132 ÷ 11"],
};
const parseAB = (s) => { const m = String(s).match(/(\d+)\s*[+\-×÷*/]\s*(\d+)/); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
// Nombre de cada columna (de derecha a izquierda). Escala a números grandes (8+ dígitos): antes el arreglo
// tenía solo 4 nombres y a partir del 5.º dígito la pizarra mostraba "undefined" (p. ej. sumar/restar de 8
// dígitos). Más allá de lo nombrado, se rotula por posición. (Detectado al probar "números de 8 dígitos".)
const COLS = ["unidades", "decenas", "centenas", "millares", "decenas de millar", "centenas de millar", "millones", "decenas de millón", "centenas de millón", "millares de millón"];
const colName = (i) => COLS[i] || `posición ${i + 1} (desde la derecha)`;
function pasosSuma(a, b) {
  const A = String(a).split("").reverse().map(Number), B = String(b).split("").reverse().map(Number);
  const n = Math.max(A.length, B.length), steps = []; let carry = 0;
  for (let i = 0; i < n; i++) {
    const x = A[i] || 0, y = B[i] || 0, s = x + y + carry, traia = carry ? ` + ${carry} que llevábamos` : "";
    steps.push(s >= 10
      ? { explica: `Sumamos las ${colName(i)}: ${x} + ${y}${traia} = ${s}. Como pasa de 9, escribimos ${s % 10} y llevamos 1.`, escribe: `${colName(i)}: ${x} + ${y}${carry ? ` + ${carry}` : ""} = ${s}` }
      : { explica: `Sumamos las ${colName(i)}: ${x} + ${y}${traia} = ${s}.`, escribe: `${colName(i)}: ${x} + ${y}${carry ? ` + ${carry}` : ""} = ${s}` });
    carry = s >= 10 ? 1 : 0;
  }
  if (carry) steps.push({ explica: "Nos llevábamos 1, que va al frente.", escribe: "llevamos 1" });
  return { texto: `${a} + ${b}`, answer: a + b, steps };
}
function pasosResta(a, b) {
  const A = String(a).split("").reverse().map(Number), B = String(b).split("").reverse().map(Number);
  const steps = []; let borrow = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i] - borrow, y = B[i] || 0;
    if (x < y) { steps.push({ explica: `Restamos las ${colName(i)}: ${x} - ${y} no se puede, así que pedimos prestada una unidad a la columna de la izquierda (vale 10): ${x + 10} - ${y} = ${x + 10 - y}.`, escribe: `${colName(i)}: ${x + 10} - ${y} = ${x + 10 - y}` }); borrow = 1; }
    else { steps.push({ explica: `Restamos las ${colName(i)}: ${x} - ${y} = ${x - y}.`, escribe: `${colName(i)}: ${x} - ${y} = ${x - y}` }); borrow = 0; }
  }
  return { texto: `${a} - ${b}`, answer: a - b, steps };
}
function pasosMult(a, b) {
  const big = Math.max(a, b), small = Math.min(a, b), u = big % 10, t = big - u, steps = [];
  if (big < 10) steps.push({ explica: `Multiplicar ${a} × ${b} es sumar el ${small} un total de ${big} veces. El resultado es ${a * b}.`, escribe: `${a} × ${b} = ${a * b}` });
  else if (u === 0) steps.push({ explica: `${a} × ${b}: multiplicamos ${big / 10} × ${small} = ${(big / 10) * small} y añadimos un cero. Resultado ${a * b}.`, escribe: `${a} × ${b} = ${a * b}` });
  else {
    steps.push({ explica: `Descomponemos ${big} en ${t} + ${u} y multiplicamos cada parte por ${small}.`, escribe: `${a} × ${b} = (${t} + ${u}) × ${small}` });
    steps.push({ explica: `${t} × ${small} = ${t * small} y ${u} × ${small} = ${u * small}. Sumamos: ${t * small} + ${u * small} = ${a * b}.`, escribe: `${t * small} + ${u * small} = ${a * b}` });
  }
  return { texto: `${a} × ${b}`, answer: a * b, steps };
}
function pasosDiv(a, b) {
  const q = a / b;
  return { texto: `${a} ÷ ${b}`, answer: q, steps: [
    { explica: `Dividir ${a} ÷ ${b} es repartir ${a} en ${b} partes iguales. Buscamos el número que por ${b} da ${a}: como ${b} × ${q} = ${a}, cada parte es ${q}.`, escribe: `${a} ÷ ${b} = ${q}   (porque ${b} × ${q} = ${a})` },
  ] };
}
// Detecta un CÁLCULO concreto ("24 + 17", "6 × 7", "52 - 27", "20 ÷ 4", "20 / 4", "20 entre 4", "6 por 7"). Solo
// números enteros; división exacta y resta no negativa (si no, → null y lo maneja Gemini). Las fracciones
// ("5/8 + 2/8") y ecuaciones ("2x + 5 = 15") ya se resolvieron en ramas anteriores, así que aquí no llegan.
function extraerOperacion(text) {
  const s = String(text).replace(/\s+/g, " ").trim(); let m;
  if (/[÷/]/.test(s) && (m = s.match(/(\d+)\s*[÷/]\s*(\d+)/))) { const a = +m[1], b = +m[2]; return (b && a % b === 0) ? { op: "division", a, b } : null; }
  if ((m = s.match(/(\d+)\s+entre\s+(\d+)/i))) { const a = +m[1], b = +m[2]; return (b && a % b === 0) ? { op: "division", a, b } : null; }
  if ((m = s.match(/(\d+)\s*(?:×|\*)\s*(\d+)/))) return { op: "multiplicacion", a: +m[1], b: +m[2] };
  if ((m = s.match(/(\d+)\s+(?:x|por)\s+(\d+)/i))) return { op: "multiplicacion", a: +m[1], b: +m[2] };
  if ((m = s.match(/(\d+)\s*-\s*(\d+)/))) { const a = +m[1], b = +m[2]; return a >= b ? { op: "resta", a, b } : null; }
  if ((m = s.match(/(\d+)\s*\+\s*(\d+)/))) return { op: "suma", a: +m[1], b: +m[2] };
  return null;
}
const ARIT = {
  suma: { escena: "suma_resuelta", lista: SUMAS, verbo: "sumar", pasos: pasosSuma,
    rec: "suma columna por columna de derecha a izquierda; si una columna pasa de 9, escribes las unidades y llevas 1.", concepto: [
    "Sumar es JUNTAR cantidades para saber cuántas hay en total.", "Suma:  juntar cantidades → total",
    "Cuando los números tienen varias cifras, sumamos columna por columna, de derecha a izquierda (primero las unidades, luego las decenas…). Si una columna pasa de 9, escribimos la cifra de las unidades y LLEVAMOS 1 a la siguiente. Veámoslo con un ejemplo."] },
  resta: { escena: "resta_resuelta", lista: RESTAS, verbo: "restar", pasos: pasosResta,
    rec: "resta columna por columna de derecha a izquierda; si arriba hay menos que abajo, pides prestada una unidad (vale 10) a la columna de la izquierda.", concepto: [
    "Restar es QUITAR una cantidad de otra: cuánto queda al sacar una parte.", "Resta:  quitar una cantidad de otra",
    "Restamos columna por columna, de derecha a izquierda. Si arriba hay menos que abajo, pedimos PRESTADA una unidad a la columna de la izquierda, que vale 10. Veámoslo con un ejemplo."] },
  multiplicacion: { escena: "multiplicacion_resuelta", lista: MULTIS, verbo: "multiplicar", pasos: pasosMult,
    rec: "descompón el número de dos cifras en decenas y unidades, multiplica cada parte y suma los resultados.", concepto: [
    "Multiplicar es SUMAR el mismo número varias veces: una forma rápida de sumar repetido.", "Multiplicar:  sumar el mismo número varias veces",
    "Para multiplicar por un número de dos cifras, lo descomponemos en decenas y unidades, multiplicamos por cada parte y sumamos. Veámoslo con un ejemplo."] },
  division: { escena: "division_resuelta", lista: DIVIS, verbo: "dividir", pasos: pasosDiv,
    rec: "busca el número que, multiplicado por el divisor, da el total (la división es la inversa de multiplicar).", concepto: [
    "Dividir es REPARTIR una cantidad en partes iguales, o ver cuántas veces cabe un número en otro.", "Dividir:  repartir en partes iguales",
    "Dividir es la operación INVERSA de multiplicar: buscamos el número que, multiplicado por el divisor, da el total. Veámoslo con un ejemplo."] },
};
// Genera una PRÁCTICA con el MISMO número de dígitos que el ejemplo (a, b) que escribió el alumno, para
// cada operación. Antes, al escribir un cálculo grande ("2876390 + 2817200"), la práctica salía de los
// presets pequeños ("47 + 25"), inconsistente con el ejemplo. (Pedido del cliente: misma cantidad de
// dígitos.) Determinista (misma consulta → misma práctica) vía Math.imul. Resta NO negativa; división EXACTA.
function practicaMismoTamano(op, a, b) {
  const lo = (L) => (L <= 1 ? 1 : Math.pow(10, L - 1));
  const hi = (L) => Math.pow(10, L) - 1;
  const La = String(Math.abs(a)).length, Lb = String(Math.abs(b)).length;
  let s = (Math.imul(a % 1000000, 131) + Math.imul(b % 1000000, 17) + 7) >>> 0;
  const rnd = (L, evitar) => {
    const l = lo(L), span = hi(L) - l + 1;
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    let v = l + (s % span);
    if (v === evitar) v = l + ((s + 1) % span);
    return v;
  };
  if (op === "suma") return `${rnd(La, a)} + ${rnd(Lb, b)}`;
  if (op === "resta") {
    let x = rnd(La, a), y = rnd(Lb, b);
    if (x < y) { const t = x; x = y; y = t; }
    if (x === y) y = Math.max(lo(Lb), y - 1);
    return `${x} - ${y}`;
  }
  if (op === "multiplicacion") return `${rnd(La, a)} × ${rnd(Lb, b)}`;
  if (op === "division") {
    // dividendo de La dígitos, divisor de Lb dígitos, división EXACTA: a' = b' × q'. Si el divisor no deja
    // sitio para un cociente ≥ 2 (La ≤ Lb), se acorta el divisor una cifra.
    const Lb2 = Lb >= La ? Math.max(1, La - 1) : Lb;
    const b2 = rnd(Lb2, b) || 2;
    const qMin = Math.max(2, Math.ceil(lo(La) / b2));
    const qMax = Math.max(qMin, Math.floor(hi(La) / b2));
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const q = qMin + (s % (qMax - qMin + 1));
    return `${b2 * q} ÷ ${b2}`;
  }
  return null;
}
function aritmeticaLSG(opts, cfg) {
  let { ejemplo, practica } = elegirBoton(cfg.lista, opts);
  // Si el alumno ESCRIBIÓ el cálculo (instancia), la práctica debe tener el MISMO número de dígitos que su
  // ejemplo (no un preset chico). Cliente: ejemplo de 7 dígitos y práctica "47 + 25".
  if (opts.instancia) {
    const [ea, eb] = parseAB(ejemplo);
    const gen = practicaMismoTamano(cfg.escena.replace(/_resuelta$/, ""), ea, eb);
    if (gen) practica = gen;
  }
  const E = cfg.pasos(...parseAB(ejemplo)), P = cfg.pasos(...parseAB(practica));
  if (opts.practica) return practicaLSG(cfg.escena, {
    recordatorio: `Recuerda: para ${cfg.verbo}, ${cfg.rec}`,
    reto1: E.texto, preg: `¿Cuánto es ${E.texto}? Escribe solo el número.`, resp: E.answer, reto2: P.texto,
  });
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  if (opts.concepto) {
    dir.push({ tipo: "hablar", texto: cfg.concepto[0] });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: cfg.concepto[1] });
    dir.push({ tipo: "hablar", texto: cfg.concepto[2] });
  }
  dir.push(
    { tipo: "hablar", texto: `Vamos a ${cfg.verbo} ${E.texto} paso a paso.` },
    { tipo: "pizarra", accion: "escribir", contenido: E.texto },
    { tipo: "esperar", segundos: 1 },
  );
  for (const s of E.steps) { dir.push({ tipo: "hablar", texto: s.explica }); dir.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe }); }
  dir.push({ tipo: "hablar", texto: `Así, ${E.texto} = ${E.answer}. Ahora te toca a ti.` });
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: `${P.texto} = ?` });
  dir.push({ tipo: "preguntar", texto: `¿Cuánto es ${P.texto}? Escribe solo el número.`, respuesta: String(P.answer), esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena: cfg.escena, intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 60, _mock: true, directivas: dir };
}
export function sumaResueltaLSG(opts = {}) { return aritmeticaLSG(opts, ARIT.suma); }
export function restaResueltaLSG(opts = {}) { return aritmeticaLSG(opts, ARIT.resta); }
export function multiplicacionResueltaLSG(opts = {}) { return aritmeticaLSG(opts, ARIT.multiplicacion); }
export function divisionResueltaLSG(opts = {}) { return aritmeticaLSG(opts, ARIT.division); }
const GEN_ARIT = { suma: sumaResueltaLSG, resta: restaResueltaLSG, multiplicacion: multiplicacionResueltaLSG, division: divisionResueltaLSG };
const SIGNO_ARIT = { suma: "+", resta: "-", multiplicacion: "×", division: "÷" };

// ── 1) ECUACIÓN LINEAL: resuelve una ecuación paso a paso + práctica de otra distinta. ──
// FÁCIL: un solo paso (coeficiente 1). NORMAL: coeficiente + término independiente (dos pasos).
// DIFÍCIL: varios términos en x que hay que AGRUPAR primero, y números mayores (tres pasos).
const LINEALES = {
  facil: ["x + 3 = 8", "x + 5 = 12", "x - 2 = 6", "x + 7 = 10", "x - 4 = 5", "x + 2 = 9"],
  normal: ["2x + 5 = 15", "3x + 2 = 14", "4x - 3 = 9", "2x - 1 = 7", "5x + 5 = 20", "3x - 6 = 6", "6x + 2 = 20", "4x + 8 = 16"],
  dificil: ["4x + 3x - 5 = 30", "5x - 2x + 7 = 25", "9x + 14 = 86", "7x - 12 = 30", "6x + 5x - 8 = 25", "8x - 3x + 4 = 39"],
};
export function linealResueltaLSG(opts = {}) {
  const { ejemplo, practica } = elegirBoton(LINEALES, opts);
  const lista = listaNivel(LINEALES, opts.nivel);
  const sol = solveLinearSteps(ejemplo) || solveLinearSteps(lista[0]);
  const solP = solveLinearSteps(practica) || solveLinearSteps(lista[1]);
  if (opts.practica) return practicaLSG("lineal_resuelta", {
    recordatorio: "Recuerda: para hallar la incógnita, despéjala pasando los números al otro lado con la operación inversa (lo que suma, resta; lo que multiplica, divide), hasta dejar la x sola.",
    reto1: sol.original, preg: `¿Cuánto vale ${sol.varName} en ${sol.original}? Escribe solo el número.`, resp: sol.answer, reto2: solP.original,
  });
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  // ENSEÑAR el tema ("enséñame ecuaciones lineales"): primero el CONCEPTO y la REGLA, no saltar directo
  // a resolver un ejercicio (queja del cliente: "pido que me enseñe y de frente va a los ejercicios").
  if (opts.concepto) {
    dir.push({ tipo: "hablar", texto: "Una ecuación lineal, o de primer grado, es una igualdad donde la incógnita (la x) está elevada solo a la 1: no tiene x² ni raíces. Resolverla significa encontrar el valor de x que hace verdadera la igualdad." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Ecuación lineal:  a·x + b = c" });
    dir.push({ tipo: "hablar", texto: "La regla para hallar la x es despejarla: los números que la acompañan pasan al otro lado con la operación inversa (lo que suma, resta; lo que resta, suma; lo que multiplica, divide), hasta dejar la x sola. Veámoslo con un ejemplo." });
  }
  dir.push(
    { tipo: "hablar", texto: `Vamos a resolver ${sol.original} paso a paso. La meta es dejar la ${sol.varName} sola en un lado del igual.` },
    { tipo: "pizarra", accion: "escribir", contenido: sol.original },
    { tipo: "esperar", segundos: 1 },
  );
  for (const s of sol.steps) {
    dir.push({ tipo: "hablar", texto: s.explica });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe });
  }
  dir.push({ tipo: "hablar", texto: `Comprobado: ${sol.varName} = ${sol.answer}. Ahora te toca a ti con otra ecuación parecida.` });
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: solP.original });
  dir.push({ tipo: "preguntar", texto: `¿Cuánto vale ${solP.varName} en ${solP.original}? Escribe solo el número.`, respuesta: solP.answer, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena: "lineal_resuelta", intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 70, _mock: true, directivas: dir };
}

// ── 2) DERIVADAS: deriva un monomio con la regla de la potencia + práctica de otro distinto. ──
// FÁCIL: rectas y potencias pequeñas (derivada constante o inmediata). NORMAL: monomios con
// coeficiente y exponente. DIFÍCIL: POLINOMIOS de varios términos (hay que derivar término a término).
const DERIVADAS = {
  facil: ["2x", "3x", "x²", "5x", "x³", "4x"],
  normal: ["x²", "2x³", "3x²", "x⁴", "5x²", "4x³", "2x⁴", "x³"],
  dificil: ["3x⁴ - 2x²", "2x³ + 5x", "4x³ - 3x² + 2x", "5x⁴ + 2x³", "x⁴ - 6x² + 9x", "3x⁵ - 4x²"],
};
function partesMonomio(m) {
  const s = canonExpr(m).replace(/\*/g, "");
  const mm = s.match(/^([+-]?\d*)x(?:\^(\d+))?$/);
  if (!mm) return null;
  const a = mm[1] === "" || mm[1] === "+" ? 1 : mm[1] === "-" ? -1 : Number(mm[1]);
  const n = mm[2] != null ? Number(mm[2]) : 1;
  return { a, n };
}
export function derivadaResueltaLSG(opts = {}) {
  const { ejemplo, practica } = elegirBoton(DERIVADAS, opts);
  const derE = computeDerivative("derivada de " + ejemplo) || "0";
  const derP = computeDerivative("derivada de " + practica) || "0";
  if (opts.practica) return practicaLSG("derivada_resuelta", {
    recordatorio: "Recuerda la regla de la potencia: baja el exponente multiplicando delante y réstale 1 (la derivada de xⁿ es n·xⁿ⁻¹). En un polinomio, deriva término a término.",
    reto1: ejemplo, preg: `¿Cuál es la derivada de ${ejemplo}?`, resp: derE, reto2: practica,
  });
  const pm = partesMonomio(ejemplo);
  // Un POLINOMIO (varios términos) no tiene un único exponente que "bajar": se deriva TÉRMINO A TÉRMINO.
  // Sin esta rama, un ejemplo difícil ("3x⁴ - 2x²") se explicaba como si fuera una recta (texto sin sentido).
  const explica = !pm
    ? `Es un polinomio de varios términos, así que lo derivamos TÉRMINO A TÉRMINO: a cada uno le aplicamos la regla de la potencia (bajamos su exponente multiplicando delante y le restamos 1). Los números solos desaparecen, porque una constante no cambia.`
    : pm.n > 1
      // Se muestra SIEMPRE el coeficiente (aunque sea 1) para que la cuenta no degenere en "2 = 2":
      // "el coeficiente 1 por el exponente 2: 1 × 2 = 2, y el nuevo exponente es 1".
      ? `Regla de la potencia: multiplicamos el coeficiente por el exponente, y al exponente le restamos 1. Aquí el coeficiente es ${pm.a} y el exponente ${pm.n}: ${pm.a} × ${pm.n} = ${pm.a * pm.n}, y el nuevo exponente es ${pm.n - 1}.`
      : `La derivada de una recta ${ejemplo} es su pendiente, ${derE}.`;
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  // ENSEÑAR el tema ("enséñame derivadas"): primero el CONCEPTO (qué es una derivada y para qué sirve)
  // y la REGLA, y SOLO DESPUÉS el ejemplo resuelto — no saltar directo a resolver un ejercicio (queja
  // del cliente: "le digo 'enséñame derivadas' y de frente me enseña a resolver ejercicios").
  if (opts.concepto) {
    dir.push({ tipo: "hablar", texto: "Una derivada mide la RAPIDEZ con la que cambia una función: en cada punto indica cuánto crece o decrece, es decir, la pendiente de su gráfica. Por eso sirve, por ejemplo, para obtener la velocidad a partir de la posición." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Derivada: razón de cambio (la pendiente) de una función" });
    dir.push({ tipo: "hablar", texto: "Para derivar una potencia usamos la REGLA DE LA POTENCIA: se baja el exponente multiplicando delante y se le resta 1. Es decir, la derivada de x elevado a n es n por x elevado a n menos 1. Veámoslo con un ejemplo." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Regla de la potencia:  la derivada de xⁿ es n·xⁿ⁻¹" });
    dir.push({ tipo: "hablar", texto: `Vamos a derivar ${ejemplo}.` });
  } else {
    dir.push({ tipo: "hablar", texto: `Vamos a derivar ${ejemplo}. Derivar mide qué tan rápido cambia una función. Para una potencia usamos la regla de la potencia: la derivada de xⁿ es n·xⁿ⁻¹.` });
  }
  dir.push(
    { tipo: "pizarra", accion: "escribir", contenido: ejemplo },
    { tipo: "esperar", segundos: 1 },
    { tipo: "hablar", texto: explica },
    { tipo: "pizarra", accion: "escribir", contenido: `derivada de ${ejemplo} = ${derE}` },
    { tipo: "hablar", texto: `Así, la derivada de ${ejemplo} es ${derE}. Ahora te toca a ti.` },
    { tipo: "pizarra", accion: "escribir", contenido: practica },
    { tipo: "preguntar", texto: `¿Cuál es la derivada de ${practica}?`, respuesta: derP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  );
  return { escena: "derivada_resuelta", intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 65, _mock: true, directivas: dir };
}

// Elige el ÍNDICE de escenario aplicado que NO se acaba de mostrar (rota con `evitar` = resumen de la
// lección previa). Si algún escenario aparece en `evitar`, salta al siguiente que NO aparece; si NINGUNO
// aparece (la lección previa era de otro tipo y su resumen no nombra ningún escenario), varía según la
// longitud del texto previo para no repetir SIEMPRE el primero. Todos los escenarios son válidos, así que
// cualquier índice da una lección correcta: esto solo aporta VARIEDAD (evita repetir el mismo caso real).
function idxEscenario(list, evitarRaw, keyOf) {
  const evit = canonExpr(evitarRaw || "");
  // Si el resumen previo MENCIONA un escenario (piden "otro ejemplo de la vida real" seguido), se AVANZA
  // al SIGUIENTE no mostrado (rota por TODA la lista, no repite). Si NO menciona ninguno (primera vez en
  // el tema, o venía de una lección numérica), se usa el escenario CANÓNICO (0): así el primer ejemplo de
  // la vida real es PREDECIBLE y coincide con la guía de aceptación (coche / cuadernos / pizza / recortar).
  // keyOf puede devolver VARIAS palabras clave separadas por espacio (p.ej. "coche velocidad"): el
  // escenario se "evita" si CUALQUIERA de sus palabras aparece en `evitar`. Así, excluir "velocidad"
  // salta TODO escenario etiquetado con esa palabra (no solo el que se mostró) — queja del cliente:
  // pedía "otro ejemplo diferente a la velocidad" y todos los ejemplos de derivada eran de velocidad.
  const hit = (c) => String(keyOf(c)).split(/\s+/).some((w) => w && evit.includes(canonExpr(w)));
  const mencionado = !!evit && list.some(hit);
  if (!mencionado) return 0;
  // AVANCE desde el ÚLTIMO escenario mencionado (índice más alto que aparece en `evitar`) hacia el
  // siguiente NO mencionado/excluido, dando la vuelta. Antes se devolvía el PRIMER no-mencionado, lo que
  // producía un ciclo de 2 (p.ej. pizza→dinero→pizza→dinero) que NUNCA llegaba al tercer escenario y, al
  // compartir números, se veía como "repite el mismo ejemplo" — bug reportado por el cliente.
  let last = -1;
  for (let i = 0; i < list.length; i++) if (hit(list[i])) last = i;
  for (let step = 1; step <= list.length; step++) {
    const j = (last + step) % list.length;
    if (!hit(list[j])) return j;
  }
  return 0; // todos los escenarios están excluidos → cae al canónico
}

// ── 2b) DERIVADA EN LA VIDA REAL: la derivada como "rapidez de cambio". El caso canónico es la
// VELOCIDAD (la velocidad es la derivada de la posición respecto al tiempo). DETERMINISTA: explica el
// SIGNIFICADO con un caso cotidiano y números concretos, y cierra con una práctica NUMÉRICA (la
// velocidad en un instante), fácil de calificar. Rota el escenario con `evitar` para que "otro ejemplo"
// no repita. Se usa cuando el alumno pide un ejemplo APLICADO / de la vida real (no un cálculo de un
// monomio) — queja del cliente: pedía derivadas "de la vida cotidiana" / "con la variación de la
// velocidad" y recibía un ejercicio numérico sin significado.
// Nota TTS: las UNIDADES se escriben con palabra completa ("segundo/metro"), NO abreviadas ("s"/"m"):
// el normalizador de voz lee una letra suelta como su NOMBRE (m→"eme", s→"ese"), igual que hace con las
// variables (x→"equis"), y no puede distinguir una unidad de una variable. Con la palabra completa se
// oye "un metro", no "eme". Los símbolos de la pizarra ("t²", "v(t) = 2t") NO se hablan (la pizarra es muda).
// Escenarios de DISTINTO tipo (no solo velocidad): así "otro ejemplo diferente a la velocidad" tiene a
// dónde ir (crecimiento de una planta, llenado de un tanque). Cada uno usa la fórmula t² (derivada 2t):
// solo cambia el CONTEXTO, las UNIDADES y el tiempo. El `key` incluye la palabra del tipo ("velocidad",
// "crecimiento", "caudal") para que la exclusión por tipo funcione. Unidades con palabra completa (TTS).
const DERIV_VIDA = [
  { key: "coche velocidad posicion rapidez rapido movimiento", obj: "un coche", mag: "posición", sym: "s", rate: "velocidad", uMag: "metros", uRate: "metros por segundo", tSg: "segundo", tPl: "segundos", verbo: "avanza",
    tabla: "en 1 segundo avanza 1 metro, en 2 segundos 4 metros, en 3 segundos 9 metros", tE: 2, tP: 5 },
  { key: "planta crecimiento altura", obj: "una planta", mag: "altura", sym: "h", rate: "rapidez de crecimiento", uMag: "centímetros", uRate: "centímetros por día", tSg: "día", tPl: "días", verbo: "crece",
    tabla: "en 1 día mide 1 centímetro, en 2 días 4 centímetros, en 3 días 9 centímetros", tE: 2, tP: 4 },
  { key: "tanque caudal volumen llenado agua", obj: "un tanque que se llena de agua", mag: "cantidad de agua", sym: "V", rate: "rapidez de llenado", uMag: "litros", uRate: "litros por minuto", tSg: "minuto", tPl: "minutos", verbo: "sube",
    tabla: "en 1 minuto hay 1 litro, en 2 minutos 4 litros, en 3 minutos 9 litros", tE: 3, tP: 5 },
];
export function derivadaAplicadaLSG(opts = {}) {
  const c = DERIV_VIDA[idxEscenario(DERIV_VIDA, opts.evitar, (s) => s.key)];
  const vE = 2 * c.tE;                  // valor de la razón de cambio en el instante del ejemplo (t² → 2t)
  const vP = 2 * c.tP;                  // valor en la práctica (respuesta calificable)
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Una derivada mide la RAPIDEZ con la que algo cambia: en cada instante indica qué tan rápido crece o decrece una cantidad." },
    { tipo: "hablar", texto: `Veámoslo con ${c.obj}: su ${c.mag} después de un tiempo t sigue la fórmula t², medida en ${c.uMag}. Fíjate: ${c.tabla}. Cada ${c.tSg} ${c.verbo} más, así que va cada vez más rápido.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.mag}: ${c.sym}(t) = t²  (${c.uMag})` },
    { tipo: "hablar", texto: `La ${c.rate} en cada instante es la derivada de la ${c.mag}. Derivamos t² con la regla de la potencia —bajamos el exponente multiplicando y le restamos 1— y queda 2t.` },
    { tipo: "pizarra", accion: "escribir", contenido: `derivada: ${c.sym}'(t) = 2t  (${c.uRate})` },
    { tipo: "hablar", texto: `Por ejemplo, a los ${c.tE} ${c.tPl} vale 2 × ${c.tE} = ${vE} ${c.uRate}. La derivada da el valor EXACTO en ese instante, no un promedio.` },
    { tipo: "hablar", texto: "Como ves, la derivada mide a qué ritmo cambian las cosas del día a día. Ahora te toca a ti." },
    { tipo: "pizarra", accion: "escribir", contenido: `derivada = 2t.   Halla su valor a los ${c.tP} ${c.tPl}.` },
    { tipo: "preguntar", texto: `Si la razón de cambio es 2t, ¿cuánto vale a los ${c.tP} ${c.tPl}? Escribe solo el número.`, respuesta: String(vP), esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "derivada_resuelta", intencion: "aprender", duracion_estimada: 80, _mock: true, directivas: dir };
}

// ── 3) FACTORIZACIÓN (diferencia de cuadrados): factoriza x² - N + práctica de otra distinta. ──
// FÁCIL: cuadrados pequeños (x² - 4). NORMAL: x² - N. DIFÍCIL: con COEFICIENTE en x² — o bien ambos son
// cuadrados (4x² - 25 → (2x-5)(2x+5)) o bien hay que sacar FACTOR COMÚN primero (2x² - 8 → 2(x-2)(x+2)).
const FACTORIZ = {
  facil: ["x² - 1", "x² - 4", "x² - 9", "x² - 16"],
  normal: ["x² - 9", "x² - 16", "x² - 25", "x² - 4", "x² - 36", "x² - 49", "x² - 1", "x² - 64"],
  dificil: ["4x² - 25", "9x² - 16", "2x² - 8", "3x² - 27", "16x² - 9", "5x² - 45"],
};
// Explicación CORRECTA de la identificación de a y b según el caso (con coeficiente, a NO es "x").
// Antes se decía siempre "a = x y b = √N", falso para "4x² - 25" (a = 2x) y para "2x² - 8" (factor común).
function explicaDifCuadrados(expr) {
  const m = canonExpr(expr).match(/^(\d*)x\^2-(\d+)$/);
  if (!m) return null;
  const c = m[1] === "" ? 1 : Number(m[1]);
  const d = Number(m[2]);
  const isSq = (n) => Number.isInteger(Math.sqrt(n));
  if (isSq(c) && isSq(d)) {
    const sc = Math.sqrt(c), sd = Math.sqrt(d);
    const aTxt = sc === 1 ? "x" : `${sc}x`;
    return `Aquí a = ${aTxt} y b = ${sd}, porque ${aTxt} × ${aTxt} = ${c === 1 ? "x²" : `${c}x²`} y ${sd} × ${sd} = ${d}. Aplicamos la regla.`;
  }
  if (d % c === 0 && isSq(d / c)) {
    const b = Math.sqrt(d / c);
    return `Primero sacamos el factor común ${c}: queda ${c}(x² - ${d / c}). Dentro del paréntesis, a = x y b = ${b}, porque ${b} × ${b} = ${d / c}. Aplicamos la regla.`;
  }
  return null;
}
export function factorizacionResueltaLSG(opts = {}) {
  let { ejemplo, practica } = elegirBoton(FACTORIZ, opts);
  const lista = listaNivel(FACTORIZ, opts.nivel);
  // Si la instancia del botón no es una diferencia de cuadrados factorizable, cae al primer preset.
  if (!computeFactorization(ejemplo)) ejemplo = lista[0];
  if (!computeFactorization(practica) || canonExpr(practica) === canonExpr(ejemplo)) {
    practica = lista.find((x) => computeFactorization(x) && canonExpr(x) !== canonExpr(ejemplo)) || lista[1];
  }
  const facE = computeFactorization(ejemplo);
  const facP = computeFactorization(practica);
  if (opts.practica) return practicaLSG("factorizacion_resuelta", {
    recordatorio: "Recuerda la diferencia de cuadrados: a² - b² = (a - b)(a + b). Identifica a y b (las raíces de cada cuadrado) y aplica la regla.",
    reto1: ejemplo, preg: `¿Cómo se factoriza ${ejemplo}? Escríbelo como producto de dos paréntesis.`, resp: facE, reto2: practica,
  });
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  // ENSEÑAR el tema ("enséñame factorización"): primero el CONCEPTO (qué es factorizar) y la REGLA, y
  // LUEGO el ejemplo — no saltar directo a resolver (misma queja del cliente que en derivadas).
  if (opts.concepto) {
    dir.push({ tipo: "hablar", texto: "Factorizar es reescribir una expresión como un PRODUCTO —una multiplicación de factores más simples— sin cambiar su valor. Es lo contrario de multiplicar: en vez de abrir paréntesis, los buscamos." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Factorizar: escribir una expresión como un producto de factores" });
    dir.push({ tipo: "hablar", texto: 'Un caso muy común es la DIFERENCIA DE CUADRADOS: un cuadrado menos otro cuadrado. Su regla es a² - b² = (a - b)(a + b). Veámoslo con un ejemplo.' });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Diferencia de cuadrados:  a² - b² = (a - b)(a + b)" });
    dir.push({ tipo: "hablar", texto: `Vamos a factorizar ${ejemplo}.` });
  } else {
    dir.push({ tipo: "hablar", texto: `Vamos a factorizar ${ejemplo}. Es una "diferencia de cuadrados": un cuadrado menos otro cuadrado. La regla es a² - b² = (a - b)(a + b).` });
  }
  dir.push(
    { tipo: "pizarra", accion: "escribir", contenido: ejemplo },
    { tipo: "esperar", segundos: 1 },
    { tipo: "hablar", texto: explicaDifCuadrados(ejemplo) || "Identificamos a y b (las raíces de cada cuadrado) y aplicamos la regla." },
    { tipo: "pizarra", accion: "escribir", contenido: `${ejemplo} = ${facE}` },
    { tipo: "hablar", texto: `Así, ${ejemplo} se factoriza como ${facE}. Ahora te toca a ti con otra parecida.` },
    { tipo: "pizarra", accion: "escribir", contenido: practica },
    { tipo: "preguntar", texto: `¿Cómo se factoriza ${practica}? Escríbelo como producto de dos paréntesis.`, respuesta: facP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  );
  return { escena: "factorizacion_resuelta", intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 65, _mock: true, directivas: dir };
}

// ════════ EJEMPLOS APLICADOS / DE LA VIDA REAL (los otros 3 temas núcleo) ════════
// Igual que en derivadas: cuando el alumno pide un ejemplo "de la vida cotidiana / real / aplicado"
// (una pregunta "leading"), NO debe recibir un ejercicio numérico suelto, sino una explicación con un
// caso cotidiano y una práctica calificable. Todo DETERMINISTA (0 coste de IA, aritmética garantizada) y
// reutilizando los motores ya probados (solveLinearSteps / computeFactorization / suma de fracciones).

// ── 1) ECUACIÓN LINEAL en la vida real, de DISTINTO tipo (compras, edad, viaje): así "otro ejemplo
//    diferente a las compras" tiene a dónde ir. Cada escenario trae su ecuación de ejemplo y su ecuación
//    de práctica (ambas con solución ENTERA), y su historia. El `key` incluye la palabra del tipo. ──
const LINEAL_VIDA = [
  { key: "compras cuadernos precio dinero tienda comprar",
    eqE: "3x + 5 = 20", histE: "En una tienda compraste 3 cuadernos iguales, pagaste 20 y te devolvieron 5 de cambio. Si cada cuaderno cuesta x, lo que costaron más el cambio es igual a lo que pagaste.",
    eqP: "4x + 2 = 18", histP: "Compraste 4 lápices iguales, pagaste 18 y te devolvieron 2 de cambio. El precio de cada lápiz cumple esta ecuación." },
  { key: "edad años ana niño hermano cumpleaños",
    eqE: "2x + 3 = 15", histE: "El doble de la edad de Ana, más 3 años, da 15. Si su edad es x, eso se escribe así.",
    eqP: "3x + 2 = 20", histP: "El triple de la edad de un niño, más 2, es 20. Su edad cumple esta ecuación." },
  { key: "taxi viaje kilometros distancia transporte pasaje",
    eqE: "2x + 5 = 15", histE: "Un taxi cobra 5 de tarifa base y 2 por cada kilómetro. Pagaste 15 en total. Si recorriste x kilómetros, eso se escribe así.",
    eqP: "3x + 4 = 19", histP: "Otro taxi cobra 4 de base y 3 por kilómetro; pagaste 19. Los kilómetros recorridos cumplen esta ecuación." },
];
export function linealAplicadaLSG(opts = {}) {
  const c = LINEAL_VIDA[idxEscenario(LINEAL_VIDA, opts.evitar, (s) => s.key)];
  const sol = solveLinearSteps(c.eqE), solP = solveLinearSteps(c.eqP);
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Las ecuaciones lineales sirven para encontrar un dato que no conoces en problemas del día a día. Veamos un ejemplo." },
    { tipo: "hablar", texto: c.histE },
    { tipo: "pizarra", accion: "escribir", contenido: sol.original },
    { tipo: "esperar", segundos: 1 },
  ];
  for (const s of sol.steps) {
    dir.push({ tipo: "hablar", texto: s.explica });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe });
  }
  dir.push({ tipo: "hablar", texto: `Así, x vale ${sol.answer}: la ecuación nos dio el dato que faltaba. Ahora te toca a ti.` });
  dir.push({ tipo: "hablar", texto: `${c.histP} Resuélvela.` });
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: solP.original });
  dir.push({ tipo: "preguntar", texto: `¿Cuánto vale x en ${solP.original}? Escribe solo el número.`, respuesta: solP.answer, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena: "lineal_resuelta", intencion: "aprender", duracion_estimada: 80, _mock: true, directivas: dir };
}

// ── 2) FRACCIONES en la vida real, de DISTINTO tipo (comida, dinero, tiempo): así "otro ejemplo
//    diferente a la comida" tiene a dónde ir. Misma operación (suma con igual denominador), otro contexto. ──
const FRACC_VIDA = [
  { key: "pizza comida pastel chocolate comer repartir",
    hist: "Una pizza está cortada en 8 partes iguales. Tú te comes 3 (3/8) y tu hermano 2 (2/8).", d: 8, a: 3, b: 2,
    pHist: "Un chocolate tiene 7 cuadritos: comes 2 (2/7) y luego 3 más (3/7).", pd: 7, pa: 2, pb: 3 },
  { key: "dinero presupuesto gastar sueldo plata mesada",
    hist: "De tu dinero del mes, gastas 1/6 en útiles y 4/6 en transporte.", d: 6, a: 1, b: 4,
    pHist: "De otro presupuesto, usas 3/10 en una cosa y 4/10 en otra.", pd: 10, pa: 3, pb: 4 },
  { key: "tiempo hora estudio dia minutos reloj",
    hist: "De una hora de estudio, dedicas 2/5 a matemáticas y 1/5 a lectura.", d: 5, a: 2, b: 1,
    pHist: "De otra hora, dedicas 4/9 a un tema y 3/9 a otro.", pd: 9, pa: 4, pb: 3 },
];
export function fraccionAplicadaLSG(opts = {}) {
  const c = FRACC_VIDA[idxEscenario(FRACC_VIDA, opts.evitar, (s) => s.key)];
  const sum = c.a + c.b, psum = c.pa + c.pb;
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Las fracciones aparecen cuando repartimos un todo en partes iguales. Veamos un ejemplo." },
    { tipo: "hablar", texto: `${c.hist} ¿Qué fracción es en total? Como tienen el mismo denominador ${c.d}, sumamos los números de arriba: ${c.a} + ${c.b} = ${sum}, y el denominador se mantiene.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.a}/${c.d} + ${c.b}/${c.d} = ${sum}/${c.d}` },
    { tipo: "hablar", texto: `Así, en total es ${sum}/${c.d}: sumar fracciones con el mismo denominador es juntar las partes. Ahora te toca a ti.` },
    { tipo: "hablar", texto: `${c.pHist} ¿Cuánto es en total?` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.pa}/${c.pd} + ${c.pb}/${c.pd} = ?` },
    { tipo: "preguntar", texto: `¿Cuánto es ${c.pa}/${c.pd} + ${c.pb}/${c.pd}? Escribe la fracción.`, respuesta: `${psum}/${c.pd}`, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "fraccion_resuelta", intencion: "aprender", duracion_estimada: 70, _mock: true, directivas: dir };
}

// ── 3) FACTORIZACIÓN (diferencia de cuadrados) en la vida real, de DISTINTO tipo: (a) GEOMÉTRICO — el
//    área que sobra al recortar un cuadrado; (b) ARITMÉTICO — truco para MULTIPLICAR rápido dos números
//    (a-b)(a+b) = a²-b². Así "otro ejemplo diferente al área" tiene a dónde ir. ──
const FACTOR_VIDA = [
  { key: "area lamina recortar cuadrado geometria figura", tipo: "area", N: 9, r: 3, pN: 16 },
  { key: "multiplicar numeros calculo mental rapido truco aritmetica", tipo: "numero", A: 10, bb: 3, pN: 25 },
];
export function factorizacionAplicadaLSG(opts = {}) {
  const c = FACTOR_VIDA[idxEscenario(FACTOR_VIDA, opts.evitar, (s) => s.key)];
  const exprP = `x² - ${c.pN}`, facP = computeFactorization(exprP);
  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  if (c.tipo === "area") {
    const exprE = `x² - ${c.N}`, facE = computeFactorization(exprE);
    dir.push(
      { tipo: "hablar", texto: "La factorización por diferencia de cuadrados tiene un significado muy visual: es el área que queda al recortar un cuadrado pequeño de uno grande." },
      { tipo: "hablar", texto: `Imagina una lámina cuadrada de lado x y le recortas un cuadrado de lado ${c.r}. El área que sobra es el cuadrado grande menos el pequeño: x² - ${c.N}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `área sobrante:  ${exprE}` },
      { tipo: "hablar", texto: `Como ${c.N} es ${c.r}², aplicamos la regla a² - b² = (a - b)(a + b) con a = x y b = ${c.r}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${exprE} = ${facE}` },
      { tipo: "hablar", texto: `Así, esa área es un rectángulo de lados (x - ${c.r}) y (x + ${c.r}). Ahora te toca a ti.` },
    );
  } else {
    const A = c.A, b = c.bb, lo = A - b, hi = A + b, sq = A * A - b * b;
    dir.push(
      { tipo: "hablar", texto: "La diferencia de cuadrados también sirve para MULTIPLICAR RÁPIDO dos números, sin hacer la cuenta larga." },
      { tipo: "hablar", texto: `Por ejemplo, ${lo} por ${hi}: fíjate que ${lo} es ${A} menos ${b}, y ${hi} es ${A} más ${b}. Es de la forma (a - b)(a + b), con a = ${A} y b = ${b}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${lo} × ${hi} = (${A} - ${b})(${A} + ${b})` },
      { tipo: "hablar", texto: `Y (a - b)(a + b) es igual a a² - b². Entonces la cuenta es ${A} al cuadrado menos ${b} al cuadrado, o sea ${A * A} menos ${b * b}, que da ${sq}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${A}² - ${b}² = ${A * A} - ${b * b} = ${sq}` },
      { tipo: "hablar", texto: "Esa misma regla, al revés, sirve para FACTORIZAR: a² - b² = (a - b)(a + b). Ahora te toca a ti." },
    );
  }
  dir.push(
    { tipo: "pizarra", accion: "escribir", contenido: exprP },
    { tipo: "preguntar", texto: `¿Cómo se factoriza ${exprP}? Escríbelo como producto de dos paréntesis.`, respuesta: facP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  );
  return { escena: "factorizacion_resuelta", intencion: "aprender", duracion_estimada: 75, _mock: true, directivas: dir };
}

// ── Detección del tema y despacho al generador correcto ──
// Extrae de un texto una función/monomio simple ("derivada de 5x²" → "5x²"), o null.
function extraerMonomio(texto) {
  // Incluye el dígito PEGADO tras la x (`\d+`) para capturar "x2"/"4x3" (exponente sin superíndice ni
  // caret); monomioLimpio lo normaliza a "x^2"/"4x^3". `/i` acepta "X" mayúscula.
  const m = String(texto).match(/[+-]?\d{0,3}\s*x\s*(?:\^\s*\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹]|\d+)?/i);
  return m ? monomioLimpio(m[0].replace(/\s+/g, "")) : null;
}
// Extrae una diferencia de cuadrados factorizable ("...factoriza x² - 9..." → "x² - 9";
// "...factoriza 9x² - 16..." → "9x² - 16"), o null. Incluye el COEFICIENTE opcional del término x²:
// sin él, "9x² - 16" casaba solo "x² - 16" y se factorizaba MAL como (x-4)(x+4) en vez de (3x-4)(3x+4)
// — bug detectado en QA. computeFactorization sí resuelve el caso con coeficiente; solo faltaba capturarlo.
function extraerDifCuadrados(texto) {
  const m = String(texto).match(/\d*\s*[a-z]\s*(?:\^\s*2|[²])\s*-\s*\d+/i);
  const inst = m ? m[0].trim().toLowerCase() : ""; // minúsculas: "X² - 9" → "x² - 9" (board coherente)
  return inst && computeFactorization(inst) ? inst : null;
}
// Extrae una SUMA de dos fracciones escrita por el alumno ("5/8 + 2/8" → [5,2,8] mismo denominador;
// "1/2 + 1/3" → [1,2,1,3] distinto denominador), o null. Se usa para resolver EXACTAMENTE lo que el
// alumno escribe (los otros 3 temas ya lo hacen; las fracciones concretas antes caían a Gemini).
function extraerFraccionSuma(texto) {
  const m = String(texto).match(/(\d+)\s*\/\s*(\d+)\s*\+\s*(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const n1 = +m[1], d1 = +m[2], n2 = +m[3], d2 = +m[4];
  if (!d1 || !d2) return null;
  return d1 === d2 ? [n1, n2, d1] : [n1, d1, n2, d2];
}

// Devuelve el LSG determinista de uno de los 4 botones, o null si la consulta no es de ninguno de
// ellos (→ el servidor sigue el flujo normal con Gemini para temas libres/avanzados, Nivel 3).
//   { query, seguimiento, contexto, currentTopic, previo }
// ¿Saludo o mensaje META (no matemático)? — para NO re-enseñar un tema por un "hola/gracias/ok".
function esSaludoOMetaBoton(n) {
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ola|que tal|como estas|gracias|muchas gracias|ok|okay|vale|listo|perfecto|adios|chao|hi|hello|thanks|thank you)\b[\s!.?]*$/.test(n);
}
// ¿La consulta es un SEGUIMIENTO de re-explicación / ayuda / "otro" sobre el tema ACTIVO (sin nombrar un
// tema nuevo)? Cubre "no entendí", "explícalo mejor", "otra vez", "para dummies", "¿por qué?", "no sé",
// "ayúdame", "otro", "más", "resuélveme otro". Sirve para que, con un tema núcleo activo, estas consultas
// se respondan DETERMINISTAS (nunca Gemini, de donde salían las lecciones incoherentes).
function esReteachBoton(q, seguimiento) {
  const n = normBoton(q);
  // Un SALUDO/META nunca es una re-explicación, aunque llegue con un tipo de seguimiento (defensa: el
  // servidor pone "reexplicar" si hay contexto, y no queremos convertir "hola/gracias" en una lección).
  if (!n || esSaludoOMetaBoton(n)) return false;
  if (["reexplicar", "continuacion", "practicar", "resolver_otro", "mas_facil", "mas_dificil"].includes(seguimiento)) return true;
  if (/\bno\s+(lo\s+|la\s+|me\s+|se\s+lo\s+)?(entend|entiend|comprend|capt|pill)/.test(n)) return true;
  if (/explica\w*\s+(lo\s+|me\s+)?(mejor|otra vez|de nuevo|de otra forma|nuevamente|bien)/.test(n)) return true;
  if (/para dummies|mas simple|mas facil de entender|no me queda claro|estoy perdid|me perd[ií]|sigo sin entend|ni idea|no lo veo/.test(n)) return true;
  if (/\botr[oa]\b|\bmas\b|resuelv|de nuevo|otra vez|sigue|contin[uú]a/.test(n)) return true;
  const p = n.split(/\s+/).filter(Boolean).length;
  if (p <= 3 && /(no se|ayud|auxilio|por que|porque)/.test(n)) return true;
  return false;
}
// Extrae lo que el alumno pide EVITAR ("un ejemplo que no sea un coche", "diferente a la pizza",
// "sin usar cuadernos", "otro que no sea el tren") → devuelve la palabra clave a excluir ("coche"), o "".
function extraerExclusion(q) {
  const n = normBoton(q);
  const m = n.match(/(?:que no (?:sea|sean|uses?|use|tenga|hable de|salga|mencione)|diferente(?:s)? al?|distint[oa] al?|sin(?: usar)?|en vez del?|en lugar del?)\s+(.+)$/);
  if (!m) return "";
  // Puede haber VARIAS exclusiones ("ni el coche ni la pelota"): se quitan artículos/conjunciones y se
  // devuelven todas las palabras clave, para EXCLUIR todos los escenarios pedidos (no solo el primero).
  const rest = m[1].replace(/\b(el|la|los|las|un|una|unos|unas|lo|de|del|ni|y|o|e|u|que|ejemplo|ejemplos|caso|casos)\b/g, " ");
  return (rest.match(/[a-zñáéíóú]{3,}/g) || []).join(" ");
}
// ¿El resumen/tema indica que la lección ACTIVA es de tipo APLICADO (vida real)? — para que un
// seguimiento que pide OTRO ejemplo / uno DIFERENTE / "que no sea X" siga siendo aplicado (otro caso de
// la vida real) en vez de caer en la lección numérica o repetir el mismo.
function esContextoAplicado(texto) {
  // Se detecta por la FRASE-CONCEPTO inicial de cada lección aplicada (estable, sea cual sea el escenario),
  // más marcas de escenario como respaldo.
  return /mide la rapidez con la que algo cambia|sirven para encontrar un dato|repartimos un todo|significado muy visual|multiplicar r[aá]pido|imagina un coche|imagina una planta|imagina un tanque|compraste \d|una pizza está cortada|un pastel se corta|de tu dinero del mes|una hora de estudio|un taxi cobra|una l[aá]mina cuadrada|recortar un cuadrado/i.test(String(texto || ""));
}
// Tema NÚCLEO (uno de los 4) al que pertenece un texto, por palabra clave o por la FORMA de la expresión
// ("2x + 5 = 15" → lineal, "x² - 9" → factorización). null si no es de ningún tema núcleo.
function temaNucleo(text) {
  const n = normBoton(text);
  if (!n) return null;
  if (/deriv/.test(n)) return "derivada";
  if (/factoriz|diferencia de cuadrados/.test(n) || /[a-z]\s*(?:\^\s*2|[²])\s*-\s*\d/i.test(text)) return "factorizacion";
  if (/fracc/.test(n) || /\d\s*\/\s*\d/.test(text)) return "fraccion";
  if (/ecuaci|lineal|primer grado|despej/.test(n) || solveLinearSteps(text) !== null) return "lineal";
  return null;
}
const GEN_APLICADA = { derivada: derivadaAplicadaLSG, lineal: linealAplicadaLSG, fraccion: fraccionAplicadaLSG, factorizacion: factorizacionAplicadaLSG };
// Generadores RESUELTOS (paso a paso) por tema núcleo; también sirven en modo PRACTICAR (opts.practica).
const GEN_RESUELTA = { derivada: derivadaResueltaLSG, lineal: linealResueltaLSG, fraccion: fraccionResueltaLSG, factorizacion: factorizacionResueltaLSG };

export function leccionBotonLSG({ query = "", seguimiento = "", contexto = "", currentTopic = "", previo = "", historial = [] } = {}) {
  // RECUPERACIÓN DE TEMA desde el HISTORIAL. Si la consulta es un "otro ejemplo" / "otra vez" / "resuélveme
  // otro" SIN tema activo (contexto/currentTopic/seguimiento vacíos), reconstruimos el tema a partir del
  // último mensaje del historial que sea de un TEMA NÚCLEO y lo tratamos como CONTINUACIÓN. Caso real: el
  // alumno recarga la página (se pierde el tema en memoria del navegador) pero el historial de conversación
  // SÍ conserva el tema; sin esto, "otro ejemplo" caía a Gemini (lección no determinista) — bug observado
  // en pruebas: tras recargar, "otro ejemplo" de derivadas se iba a Gemini en vez de la lección determinista.
  if (!seguimiento && !contexto && !currentTopic && Array.isArray(historial) && historial.length && esReteachBoton(query, "")) {
    for (let i = historial.length - 1; i >= 0; i--) {
      const h = historial[i];
      if (!h || normBoton(h) === normBoton(query)) continue; // saltar la consulta actual
      if (temaNucleo(h)) { contexto = h; seguimiento = "continuacion"; break; }
    }
  }
  const SEG_OTRO = new Set(["continuacion", "practicar", "resolver_otro"]);
  // "más fácil"/"más difícil" son seguimientos de NIVEL del tema activo: se mantiene el tema y se cambia
  // la lista de ejercicios a la del nivel pedido (antes caían a Gemini y devolvían algo trivial).
  const SEG_NIVEL = { mas_facil: "facil", mas_dificil: "dificil" };
  // NIVEL también por TEXTO libre: "dame ejercicios MÁS COMPLEJOS", "algo más difícil", "números de 8
  // dígitos", "más avanzados" → nivel difícil; "más fácil/sencillo/básico" → fácil. (Queja del cliente:
  // pedía ejercicios "más complejos, como dividir números de 8 dígitos" y recibía uno trivial.)
  const nqNivel = normBoton(query);
  const nivel = SEG_NIVEL[seguimiento]
    || (/\bmas\s+f[aá]cil|sencill|b[aá]sic|\bsimple/.test(nqNivel) ? "facil"
      : /\bmas\s+(dif[ií]cil|complej|complicad|avanzad|dur)|\bcomplej|\bavanzad|\bdif[ií]cil|\d+\s*d[ií]gitos|numeros?\s+grandes|\bmas\s+grandes/.test(nqNivel) ? "dificil"
      : "normal");
  const esSeg = SEG_OTRO.has(seguimiento) || !!SEG_NIVEL[seguimiento];
  // En un seguimiento el tema es el ACTIVO (contexto); en una pulsación nueva, la propia consulta.
  const base = (esSeg && (contexto || currentTopic)) ? (contexto || currentTopic) : query;
  const n = normBoton(base);
  // ¿Es un pedido de ENSEÑAR/APRENDER el tema ("enséñame ecuaciones lineales", "quiero aprender…",
  // "explícame…") en vez de resolver un ejercicio concreto? En ese caso la lección debe empezar por el
  // CONCEPTO y la REGLA (no saltar directo a resolver un ejercicio) — queja del cliente.
  const pideEnsenar = /\bense[nñ]a|\baprend|expl[ií]ca|qu[eé]\s+(es|son)\b|c[oó]mo\s+se\b|concepto|teor[ií]a/.test(n);
  // MODO APRENDER que se MANTIENE en un seguimiento: si el tema se abrió con "enséñame/explícame/el
  // concepto de [tema]" (n = contexto en un seguimiento), un "otro ejemplo" debe seguir ENSEÑANDO el
  // concepto con un ejemplo nuevo, NO pasar a solo resolver. (Queja del cliente: pidió el concepto de
  // fracciones con otros ejemplos y el sistema mostró solo el proceso de resolución, sin el concepto.)
  // Una petición de NIVEL ("más difícil") o de resolver otra ("resuélveme otra") sí cambia a resolver.
  // Si el alumno pide EXPLÍCITAMENTE un ejercicio o "dame/ponme UN ejemplo/ejercicio" (aunque sea dentro
  // de una sesión de CONCEPTO), quiere el EJERCICIO, no que le re-expliquen el concepto. Queja del cliente:
  // "pido que me dé EJERCICIOS y me brinda CONCEPTOS". Distinto de "otro ejemplo"/"otro" (sin verbo de
  // pedir + "un"), que en una sesión de concepto SÍ mantiene el concepto y solo rota el ejemplo.
  const pidePracticaExpl = /\bejercicios?\b|\bpractic|\bresuelv|(dame|deme|denme|ponme|pon|quiero|quisiera|necesito|muestrame|muestra|dejame|deja)\s+(un|una)\s+(ejemplo|ejercicio)/.test(normBoton(query));
  const conceptoOn = pideEnsenar && (!esSeg || seguimiento === "continuacion" || seguimiento === "practicar") && !pidePracticaExpl;
  // PRACTICAR: el alumno pide EJERCICIOS para resolverlos ÉL MISMO — no que se los resuelvan ni que le
  // re-expliquen el concepto. Señales: el botón "otro ejercicio" (seguimiento), "quiero practicar", "para
  // practicar / que yo resuelva / yo mismo / por mi cuenta / para yo resolverlos", o mencionar "ejercicios/
  // problemas" (plural). Se EXCLUYE si pide la SOLUCIÓN (eso es resolver). Alineado con el clasificador.
  // Queja del cliente: "le pido ejercicios para yo resolverlos y me sigue enseñando / no obedece".
  const nPract = normBoton(query);
  const pideSolucion = /\b(la solucion|el resultado|la respuesta|resuelveme|dame el valor|dame la solucion)\b/.test(nPract);
  const pidePracticar = !pideSolucion && (
    seguimiento === "practicar"
    || /\bpractic/.test(nPract)
    || /\bpara\s+(practicar|ejercitar|reforzar)\b/.test(nPract)
    || /\bpara\s+que\s+(?:yo|tu)?\s*(?:lo|la|los|las)?\s*(?:resuelva|resuelvas|practique|trabaje|intente)\b|\bque\s+yo\s*(?:lo|la|los|las)?\s*resuelv/.test(nPract)
    || /\bpara\s+(?:yo\s+)?resolver(?:l[oa]s?)?\b|\bpor\s+mi\s+cuenta\b|\byo\s+mism[oa]\b/.test(nPract)
    || /\bejercicios\b|\bproblemas\b/.test(nPract)
  );
  const commonRet = (tema, lsg) => ({ tema, escena: lsg.escena, intencion: lsg.intencion || "resolver", modelo: `${tema}-resuelto`, lsg });

  // 0) ¿PIDE UN EJEMPLO APLICADO / DE LA VIDA REAL (no un cálculo numérico)? "un ejemplo de la vida
  //    cotidiana", "con la variación de la velocidad", "para qué sirve", "una aplicación real"... El
  //    alumno NO quiere que le resolvamos un monomio: quiere ENTENDER el SIGNIFICADO del concepto con un
  //    caso real. Esto se comprueba sobre la CONSULTA REAL (en un seguimiento, `base` pasa a ser el tema,
  //    así que el detonante "variación de la velocidad" está en `query`, no en `base`). Para DERIVADAS
  //    damos una lección aplicada DETERMINISTA (velocidad = razón de cambio); para otro tema en alcance,
  //    la explicación conceptual la genera Gemini (Nivel 2). Queja del cliente: pedía derivadas "de la
  //    vida cotidiana" / "con la variación de la velocidad" y recibía cálculos o ejercicios numéricos.
  const nQ = normBoton(query);
  const ctxTema = normBoton(`${contexto} ${currentTopic}`);
  const pideAplicado = /vida cotidiana|vida real|vida diaria|mundo real|cotidian|d[ií]a a d[ií]a|para qu[eé]\s+(sirve|sirven|se usa|se utiliza)|aplicaci[oó]n|aplicad|caso real|ejemplo real|situaci[oó]n real|ejemplo pr[aá]ctico|en la pr[aá]ctica|variaci[oó]n de (?:la )?velocidad|\bvelocidad\b|\baceleraci[oó]n\b/.test(nQ);
  // Exclusión pedida ("que no sea un coche") y si pide OTRO/DIFERENTE ejemplo. Si la lección ACTIVA es
  // aplicada (vida real) y el alumno pide otro/diferente/"que no sea X", debe seguir siendo APLICADO
  // (otro caso real, EXCLUYENDO lo pedido) — no repetir el mismo ni caer en la lección numérica.
  // (Queja del cliente: "que no sea un coche" seguía dando el coche; "otro de la vida cotidiana" no daba ejemplo.)
  const excluir = extraerExclusion(query);
  const pideOtroDiferente = !!excluir || /\b(otr[oa]|diferente|distint[oa]|nuev[oa])\b/.test(nQ);
  const ctxAplicado = esContextoAplicado(`${previo} ${contexto} ${currentTopic}`);
  if (pideAplicado || (ctxAplicado && pideOtroDiferente)) {
    // `evitar` combina el resumen previo (lo ya mostrado) + lo que el alumno pide EXCLUIR, para que la
    // rotación de escenario salte tanto lo anterior como lo excluido.
    const evitarAp = `${previo} ${excluir}`.trim();
    // Se despacha al MISMO tema, pero a su lección APLICADA determinista (no a la numérica). El tema se
    // toma de la consulta O del CONTEXTO activo. OJO: en un seguimiento ("explícalo con ejemplos de la
    // vida real"), el frontend manda como contexto/currentTopic la CONSULTA que abrió el tema (p.ej.
    // "Resuelve 2x + 5 = 15"), que NO contiene la palabra "ecuación/lineal". Por eso, además de las
    // palabras clave, se detecta el tema por la FORMA de la expresión (una ecuación lineal, una
    // diferencia de cuadrados o una fracción en el contexto). Sin esto caía a Gemini, que generaba
    // lecciones incoherentes (p.ej. narrar "2x = 10" y preguntar "2x = 6") — bug reportado por el cliente.
    const tt = `${nQ} ${ctxTema}`;
    const enCtx = `${query} ${contexto} ${currentTopic}`;
    const hayLineal = solveLinearSteps(query) !== null || solveLinearSteps(contexto) !== null || solveLinearSteps(currentTopic) !== null;
    const hayDifCuad = /[a-z]\s*(?:\^\s*2|[²])\s*-\s*\d/i.test(enCtx);
    const hayFrac = /\d\s*\/\s*\d/.test(enCtx);
    if (/deriv/.test(nQ) || /velocidad|aceleraci|variaci[oó]n/.test(nQ) || /deriv/.test(ctxTema)) return commonRet("derivada", derivadaAplicadaLSG({ evitar: evitarAp }));
    if (/fracc/.test(tt) || (hayFrac && !hayLineal)) return commonRet("fraccion", fraccionAplicadaLSG({ evitar: evitarAp }));
    if (/factoriz|diferencia de cuadrados/.test(tt) || hayDifCuad) return commonRet("factorizacion", factorizacionAplicadaLSG({ evitar: evitarAp }));
    if (/ecuaci|lineal|primer grado|despej/.test(tt) || hayLineal) return commonRet("lineal", linealAplicadaLSG({ evitar: evitarAp }));
    return null; // aplicado pero sin tema identificable → explicación conceptual la da Gemini (Nivel 2)
  }

  // 1) DERIVADAS. Si nombra una función NO polinómica (trig, log, raíz, eˣ) → null (lo hace Gemini, Nivel 3).
  if (/deriv/.test(n)) {
    if (/\b(sen|sin|cos|tan|cot|sec|csc|log|ln|exp|ra[ií]z|sqrt)\b|√|e\s*\^/.test(n)) return null;
    const instancia = extraerMonomio(base);
    return commonRet("derivada", derivadaResueltaLSG({ evitar: previo, instancia, seguimiento: esSeg, nivel, concepto: conceptoOn, practica: pidePracticar }));
  }

  // 2) FACTORIZACIÓN (diferencia de cuadrados). Con una expresión concreta NO factorizable así
  //    (trinomio, etc.) → null (Gemini). Genérica ("factorizar") o una diferencia de cuadrados → determinista.
  if (/factoriz|diferencia de cuadrados/.test(n)) {
    const instancia = extraerDifCuadrados(base);
    // El alumno escribió una EXPRESIÓN concreta con potencia (x², x³, x⁴, x^n…) que NO es una diferencia
    // de cuadrados factorizable con enteros (x²-2, x³-8 —diferencia de CUBOS—, x²+9 —suma—, trinomios…):
    // lo maneja Gemini. NO caer a un PRESET, porque mostraría OTRA expresión distinta de la que pidió el
    // alumno (p. ej. pedir "factoriza x³ - 8" y ver "x² - 9") — incoherente, del tipo de queja del cliente.
    // Solo el pedido GENÉRICO ("enséñame factorización", "ejercicio de factorización") usa un preset.
    if (!instancia && /[a-z]\s*(?:\^\s*\d|[²³⁴⁵⁶⁷⁸⁹])/i.test(base)) return null;
    return commonRet("factorizacion", factorizacionResueltaLSG({ evitar: previo, instancia, seguimiento: esSeg, nivel, concepto: conceptoOn, practica: pidePracticar }));
  }

  // 3) FRACCIONES. El tema genérico ("ejercicio/ejemplo de fracciones", "enséñame fracciones") O una SUMA
  //    CONCRETA que el alumno escribe ("5/8 + 2/8"). Con la suma concreta se resuelve ESA (paridad con los
  //    otros 3 temas); antes una fracción concreta caía a Gemini (lección no determinista, sin práctica
  //    calificable) — hueco detectado en QA.
  const fracInst = extraerFraccionSuma(base);
  if (/fracc/.test(n) || fracInst) {
    const evitarFrac = (String(previo).match(/\d+\s*\/\s*\d+\s*[+\-]\s*\d+\s*\/\s*\d+/) || [])[0] || "";
    // La instancia concreta se usa SOLO en una consulta NUEVA ("5/8 + 2/8"); en un seguimiento ("otro
    // ejemplo") se IGNORA y se ROTA (igual que los otros temas), si no repetiría siempre la misma suma.
    const instFrac = esSeg ? null : fracInst;
    // "enséñame fracciones" (sin fracción concreta) → CONCEPTO primero; con fracción concreta → resolver ESA.
    return commonRet("fraccion", fraccionResueltaLSG({ evitar: evitarFrac, nivel, concepto: !instFrac && conceptoOn, instancia: instFrac, practica: pidePracticar }));
  }

  // 4) ECUACIÓN LINEAL. Una ecuación lineal concreta ("2x + 5 = 15") o el tema genérico ("ecuación lineal").
  //    Se usa la ecuación LIMPIA (sol.original), no la frase entera ("Resuelve 2x + 5 = 15"), para que la
  //    práctica se elija DISTINTA de verdad (si no, "2x + 5 = 15" del preset parecía distinta de la frase).
  //    IMPORTANTE: solo ecuaciones de PRIMER GRADO. Si la consulta pide CUADRÁTICAS / segundo grado /
  //    cúbicas / TRIGONOMÉTRICAS / exponenciales / logarítmicas / diferenciales / sistemas / inecuaciones
  //    (o trae una potencia x²), NO es la lección lineal determinista → null (que lo enseñe Gemini,
  //    Nivel 2/3). Antes "ecuaciones cuadráticas/trigonométricas" casaba con "ecuaciones" y daba una
  //    lección lineal (2x+5=15) — defecto reportado por el cliente.
  const noLineal = /cuadrat|segundo grado|2do grado|2\.?\s*grado|c[uú]bic|tercer grado|bicuadr|polinom|trigonometr|\bseno\b|\bcoseno\b|\btangente\b|exponencial|logaritm|\bln\b|diferencial|integral|radical|\birracional|racional|matriz|matricial|vectorial|sistema|inecuaci|desigualdad|[a-z]\s*(?:\^\s*[2-9]|[²³⁴⁵⁶⁷⁸⁹])/.test(n);
  const solBase = solveLinearSteps(base);
  const instLin = solBase ? solBase.original : null;
  if (!noLineal && (instLin || /\becuaci[oó]n(?:es)?\b|\blineal(?:es)?\b|primer grado/.test(n))) {
    // "enséñame ecuaciones lineales" (sin una ecuación concreta) → enseñar el CONCEPTO primero.
    return commonRet("lineal", linealResueltaLSG({ evitar: previo, instancia: instLin, seguimiento: esSeg, nivel, concepto: !instLin && conceptoOn, practica: pidePracticar }));
  }

  // 5) ARITMÉTICA BÁSICA (suma, resta, multiplicación, división). Un CÁLCULO concreto ("24 + 17", "6 × 7",
  //    "52 - 27", "20 ÷ 4", "20 entre 4", "6 por 7") o el tema genérico ("enséñame a sumar/restar/
  //    multiplicar/dividir"). Es lo más elemental y el cliente lo pidió explícitamente: NO debe caer a
  //    Gemini (que interpretaba "sumar" como "sumar fracciones"). Va DESPUÉS de fracciones/lineal para que
  //    "5/8 + 2/8" y "2x + 5 = 15" no lleguen aquí. Guard: si es ALGEBRAICO (x, polinomio…) → no es
  //    aritmética básica (lo maneja Gemini).
  const opInst = extraerOperacion(base);
  const algebraico = /[a-z]\s*[²³⁴⁵⁶⁷⁸⁹]|\bx\b|\^|polinom|monomi|[aá]lgebra|variable|ecuaci|deriv|factoriz|fracc/.test(n);
  const opTema = algebraico ? null
    : /\bsum(a|ar|amos|as|en|arle|ale)?\b|adici[oó]n|adicionar/.test(n) ? "suma"
    : /\brest(a|ar|as|o|ame|amos|arle)?\b|sustrac|substrac/.test(n) ? "resta"
    : /\bmultiplic|\btablas?\s+de\s+multiplicar\b/.test(n) ? "multiplicacion"
    : /\bdivid|divisi[oó]n|\brepart/.test(n) ? "division"
    : null;
  const opActivo = (opInst && opInst.op) || opTema;
  if (opActivo) {
    const instancia = (!esSeg && opInst && opInst.op === opActivo) ? `${opInst.a} ${SIGNO_ARIT[opActivo]} ${opInst.b}` : null;
    return commonRet(opActivo, GEN_ARIT[opActivo]({ evitar: previo, instancia, seguimiento: esSeg, nivel, concepto: !instancia && conceptoOn, practica: pidePracticar }));
  }

  // ── PRACTICAR con tema núcleo ACTIVO pero SIN nombrarlo en la consulta ──
  // "dame ejercicios más complejos para yo resolverlos" dentro de una sesión de ecuaciones lineales: no
  // nombra el tema, así que las ramas 1-5 no dispararon, pero el alumno quiere EJERCICIOS del tema activo
  // para resolverlos ÉL. Se entregan en modo PRACTICAR (retos sin resolver, calificables), en vez de
  // re-enseñar o caer a Gemini. (Queja del cliente: "pido ejercicios para yo resolverlos y me sigue enseñando".)
  if (pidePracticar) {
    const temaP = temaNucleo(base) || temaNucleo(contexto) || temaNucleo(currentTopic);
    if (temaP && GEN_RESUELTA[temaP]) {
      return commonRet(temaP, GEN_RESUELTA[temaP]({ evitar: previo, seguimiento: esSeg, nivel, practica: true }));
    }
  }

  // ── RED DE SEGURIDAD: los 4 temas núcleo NUNCA caen en Gemini por un seguimiento ──
  // Si hay un TEMA NÚCLEO ACTIVO (contexto/currentTopic) y la consulta es un seguimiento de
  // re-explicación/ayuda/"otro" (no un tema nuevo ni un saludo), se re-enseña con la versión APLICADA
  // determinista del tema —coherente, correcta y calificable— en lugar de mandar "no entendí" / "¿por
  // qué?" / "explícalo mejor" a Gemini, que generaba lecciones incoherentes (narraba un valor y
  // preguntaba otro). Cierra TODA la clase de bug: dentro de un tema núcleo se responde SIEMPRE
  // determinista, salvo que el alumno nombre explícitamente un tema nuevo (esas consultas ya salieron
  // arriba por las ramas 1-4 o no tienen tema núcleo activo).
  const temaActivo = temaNucleo(contexto) || temaNucleo(currentTopic);
  if (temaActivo && GEN_APLICADA[temaActivo] && esReteachBoton(query, seguimiento)) {
    return commonRet(temaActivo, GEN_APLICADA[temaActivo]({ evitar: previo }));
  }

  return null; // no es ninguno de los 4 botones → flujo normal (Gemini)
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
      preg("Ahora tú: ¿cómo se factoriza x² − 4? (por ejemplo: (x+2)(x−2))", "(x+2)(x-2)"),
    );
  } else {
    const { v, n, raiz } = d;
    dir.push(
      { tipo: "hablar", texto: `Vamos a factorizar ${v}² − ${n}. Es una "diferencia de cuadrados", porque ${n} es ${raiz} al cuadrado (${raiz} × ${raiz} = ${n}).` },
      { tipo: "pizarra", accion: "escribir", contenido: `${v}² − ${n}   (o sea ${v}² − ${raiz}²)` },
      { tipo: "hablar", texto: `La regla es: a² − b² = (a + b)(a − b). Aquí "a" es ${v} y "b" es ${raiz}.` },
      { tipo: "pizarra", accion: "escribir", contenido: `${v}² − ${n} = (${v} + ${raiz})(${v} − ${raiz})` },
      { tipo: "hablar", texto: `Por eso ${v}² − ${n} se factoriza como (${v} + ${raiz})(${v} − ${raiz}).` },
      preg(`Ahora tú: ¿cómo se factoriza ${v}² − 4? (por ejemplo: (${v}+2)(${v}−2))`, `(${v}+2)(${v}-2)`),
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
