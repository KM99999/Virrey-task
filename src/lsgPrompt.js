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
  // Rota a la SIGUIENTE tras la ya mostrada; la práctica usa la siguiente (siempre distinta).
  const hay = canonExpr(evitar);
  let last = -1;
  for (let i = 0; i < lista.length; i++) if (hay.includes(canonExpr(textoFrac(lista[i])))) last = i;
  const eA = lista[(last + 1) % lista.length], eB = lista[(last + 2) % lista.length];
  const dificil = nivel === "dificil";
  const A = dificil ? distintoDen(eA) : mismoDen(eA);
  const B = dificil ? distintoDen(eB) : mismoDen(eB);

  const dir = [{ tipo: "avatar", accion: "sonreir" }];
  // ENSEÑAR el tema ("enséñame fracciones"): primero el CONCEPTO (qué es una fracción) y la REGLA,
  // igual que en los otros temas, para no saltar directo al ejercicio (paridad con lineal/derivadas/factoriz.).
  if (o.concepto) {
    dir.push({ tipo: "hablar", texto: "Una fracción representa partes de un todo: el número de arriba es el numerador (las partes que tomamos) y el de abajo es el denominador (en cuántas partes iguales se divide el todo)." });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: "Fracción:  numerador / denominador" });
    dir.push({ tipo: "hablar", texto: "Para sumar fracciones con el mismo denominador, se suman los numeradores y se mantiene el denominador. Si los denominadores son distintos, primero se igualan. Veámoslo con un ejemplo." });
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
const ESCENAS_BOTON = new Set(["lineal_resuelta", "derivada_resuelta", "factorizacion_resuelta", "fraccion_resuelta"]);
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
  for (let i = 0; i < lista.length; i++) if (hay.includes(canonExpr(lista[i]))) last = i;
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
    const practica = lista.find((x) => canonExpr(x) !== canonExpr(instancia)) || lista[0];
    return { ejemplo: instancia, practica };
  }
  if (!seguimiento) return { ejemplo: lista[0], practica: lista[1] };
  return rotarBoton(lista, evitar);
}

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
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Vamos a derivar ${ejemplo}. Derivar mide qué tan rápido cambia una función. Para una potencia usamos la regla de la potencia: la derivada de xⁿ es n·xⁿ⁻¹.` },
    { tipo: "pizarra", accion: "escribir", contenido: ejemplo },
    { tipo: "esperar", segundos: 1 },
    { tipo: "hablar", texto: explica },
    { tipo: "pizarra", accion: "escribir", contenido: `derivada de ${ejemplo} = ${derE}` },
    { tipo: "hablar", texto: `Así, la derivada de ${ejemplo} es ${derE}. Ahora te toca a ti.` },
    { tipo: "pizarra", accion: "escribir", contenido: practica },
    { tipo: "preguntar", texto: `¿Cuál es la derivada de ${practica}?`, respuesta: derP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "derivada_resuelta", intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 65, _mock: true, directivas: dir };
}

// ── 2b) DERIVADA EN LA VIDA REAL: la derivada como "rapidez de cambio". El caso canónico es la
// VELOCIDAD (la velocidad es la derivada de la posición respecto al tiempo). DETERMINISTA: explica el
// SIGNIFICADO con un caso cotidiano y números concretos, y cierra con una práctica NUMÉRICA (la
// velocidad en un instante), fácil de calificar. Rota el escenario con `evitar` para que "otro ejemplo"
// no repita. Se usa cuando el alumno pide un ejemplo APLICADO / de la vida real (no un cálculo de un
// monomio) — queja del cliente: pedía derivadas "de la vida cotidiana" / "con la variación de la
// velocidad" y recibía un ejercicio numérico sin significado.
const DERIV_VIDA = [
  { obj: "un coche", mag: "posición",       sym: "s", pos: "t²",  tabla: "a 1 s ha avanzado 1 m; a 2 s, 4 m; a 3 s, 9 m",   k: 2,  tE: 2, tP: 5 },
  { obj: "una pelota que cae", mag: "distancia caída", sym: "h", pos: "5t²", tabla: "a 1 s ha caído 5 m; a 2 s, 20 m; a 3 s, 45 m", k: 10, tE: 2, tP: 4 },
  { obj: "un tren", mag: "posición",        sym: "s", pos: "3t²", tabla: "a 1 s ha avanzado 3 m; a 2 s, 12 m; a 3 s, 27 m", k: 6,  tE: 3, tP: 5 },
];
export function derivadaAplicadaLSG(opts = {}) {
  const evit = canonExpr(opts.evitar || "");
  let idx = DERIV_VIDA.findIndex((c) => !evit.includes(canonExpr(c.obj)));
  if (idx < 0) idx = 0;
  const c = DERIV_VIDA[idx];
  const vel = `${c.k}t`;               // velocidad = derivada de la posición (regla de la potencia)
  const vE = c.k * c.tE;               // velocidad en el instante del ejemplo
  const vP = c.k * c.tP;               // velocidad en la práctica (respuesta calificable)
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Una derivada mide la RAPIDEZ con la que algo cambia. El ejemplo más cotidiano es la velocidad: la velocidad es la derivada de la posición respecto al tiempo, es decir, qué tan rápido cambia tu posición." },
    { tipo: "hablar", texto: `Imagina ${c.obj}: su ${c.mag} a los t segundos es ${c.sym}(t) = ${c.pos} metros. Fíjate: ${c.tabla}. Cada segundo avanza más, así que va cada vez más rápido.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.mag}: ${c.sym}(t) = ${c.pos}  (metros)` },
    { tipo: "hablar", texto: `La velocidad en cada instante es la derivada de la ${c.mag}. Derivamos ${c.pos} con la regla de la potencia —bajamos el exponente multiplicando y le restamos 1— y queda ${vel}: esa es la velocidad en el segundo t.` },
    { tipo: "pizarra", accion: "escribir", contenido: `velocidad: v(t) = ${vel}  (m/s)` },
    { tipo: "hablar", texto: `Por ejemplo, a los ${c.tE} segundos la velocidad es ${c.k} × ${c.tE} = ${vE} metros por segundo. La derivada da la velocidad EXACTA en ese instante, no un promedio.` },
    { tipo: "hablar", texto: "Como ves, la derivada no es solo un cálculo: te dice a qué ritmo cambian las cosas del día a día. Ahora te toca a ti, con el mismo móvil." },
    { tipo: "pizarra", accion: "escribir", contenido: `v(t) = ${vel}.   Halla la velocidad a los ${c.tP} segundos.` },
    { tipo: "preguntar", texto: `Si la velocidad es v(t) = ${vel}, ¿cuál es la velocidad a los ${c.tP} segundos? Escribe solo el número.`, respuesta: String(vP), esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
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
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: `Vamos a factorizar ${ejemplo}. Es una "diferencia de cuadrados": un cuadrado menos otro cuadrado. La regla es a² - b² = (a - b)(a + b).` },
    { tipo: "pizarra", accion: "escribir", contenido: ejemplo },
    { tipo: "esperar", segundos: 1 },
    { tipo: "hablar", texto: explicaDifCuadrados(ejemplo) || "Identificamos a y b (las raíces de cada cuadrado) y aplicamos la regla." },
    { tipo: "pizarra", accion: "escribir", contenido: `${ejemplo} = ${facE}` },
    { tipo: "hablar", texto: `Así, ${ejemplo} se factoriza como ${facE}. Ahora te toca a ti con otra parecida.` },
    { tipo: "pizarra", accion: "escribir", contenido: practica },
    { tipo: "preguntar", texto: `¿Cómo se factoriza ${practica}? Escríbelo como producto de dos paréntesis.`, respuesta: facP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "factorizacion_resuelta", intencion: opts.concepto ? "aprender" : "resolver", duracion_estimada: 65, _mock: true, directivas: dir };
}

// ════════ EJEMPLOS APLICADOS / DE LA VIDA REAL (los otros 3 temas núcleo) ════════
// Igual que en derivadas: cuando el alumno pide un ejemplo "de la vida cotidiana / real / aplicado"
// (una pregunta "leading"), NO debe recibir un ejercicio numérico suelto, sino una explicación con un
// caso cotidiano y una práctica calificable. Todo DETERMINISTA (0 coste de IA, aritmética garantizada) y
// reutilizando los motores ya probados (solveLinearSteps / computeFactorization / suma de fracciones).

// ── 1) ECUACIÓN LINEAL en la vida real: un problema de compras (dato desconocido = precio). ──
const LINEAL_VIDA = [
  { cosa: "cuadernos", cosaS: "cuaderno", a: 3, b: 5, c: 20 }, // 3x + 5 = 20 → 5
  { cosa: "lápices",   cosaS: "lápiz",    a: 4, b: 2, c: 18 }, // 4x + 2 = 18 → 4
  { cosa: "manzanas",  cosaS: "manzana",  a: 2, b: 6, c: 16 }, // 2x + 6 = 16 → 5
];
export function linealAplicadaLSG(opts = {}) {
  const evit = canonExpr(opts.evitar || "");
  let i = LINEAL_VIDA.findIndex((c) => !evit.includes(canonExpr(c.cosa)));
  if (i < 0) i = 0;
  const E = LINEAL_VIDA[i], P = LINEAL_VIDA[(i + 1) % LINEAL_VIDA.length];
  const sol = solveLinearSteps(`${E.a}x + ${E.b} = ${E.c}`);
  const solP = solveLinearSteps(`${P.a}x + ${P.b} = ${P.c}`);
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Las ecuaciones lineales sirven para resolver problemas del día a día donde hay un dato que no conoces. Veamos un ejemplo de compras." },
    { tipo: "hablar", texto: `Compraste ${E.a} ${E.cosa} iguales, pagaste ${E.c} y te devolvieron ${E.b} de cambio. Si cada ${E.cosaS} cuesta x, lo que costaron más el cambio es igual a lo que pagaste.` },
    { tipo: "pizarra", accion: "escribir", contenido: sol.original },
    { tipo: "esperar", segundos: 1 },
  ];
  for (const s of sol.steps) {
    dir.push({ tipo: "hablar", texto: s.explica });
    dir.push({ tipo: "pizarra", accion: "escribir", contenido: s.escribe });
  }
  dir.push({ tipo: "hablar", texto: `Así, cada ${E.cosaS} cuesta ${sol.answer}: la ecuación nos dio el dato que faltaba. Ahora te toca a ti.` });
  dir.push({ tipo: "hablar", texto: `Compraste ${P.a} ${P.cosa}, pagaste ${P.c} y te devolvieron ${P.b} de cambio. El precio de cada uno cumple ${solP.original}.` });
  dir.push({ tipo: "pizarra", accion: "escribir", contenido: solP.original });
  dir.push({ tipo: "preguntar", texto: `¿Cuánto cuesta cada ${P.cosaS}? Escribe solo el número.`, respuesta: solP.answer, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" });
  return { escena: "lineal_resuelta", intencion: "aprender", duracion_estimada: 80, _mock: true, directivas: dir };
}

// ── 2) FRACCIONES en la vida real: repartir algo (pizza, chocolate, jugo) en partes iguales. ──
const FRACC_VIDA = [
  { hist: "Una pizza está cortada en 8 partes iguales. Tú te comes 3 (3/8) y tu hermano 2 (2/8).", d: 8, a: 3, b: 2,
    pHist: "Un chocolate tiene 7 cuadritos: comes 2 (2/7) y luego 3 más (3/7).", pd: 7, pa: 2, pb: 3 },
  { hist: "Un pastel se corta en 5 porciones iguales. Comes 2 (2/5) y tu amiga 1 (1/5).", d: 5, a: 2, b: 1,
    pHist: "Una jarra rinde 9 vasos: bebes 4 (4/9) y tu amigo 3 (3/9).", pd: 9, pa: 4, pb: 3 },
];
export function fraccionAplicadaLSG(opts = {}) {
  const evit = canonExpr(opts.evitar || "");
  let i = FRACC_VIDA.findIndex((c) => !evit.includes(canonExpr(c.hist.slice(0, 14))));
  if (i < 0) i = 0;
  const c = FRACC_VIDA[i];
  const sum = c.a + c.b, psum = c.pa + c.pb;
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "Las fracciones aparecen todo el tiempo cuando repartimos algo en partes iguales: una pizza, un chocolate, una jarra de jugo. Veamos un ejemplo." },
    { tipo: "hablar", texto: `${c.hist} ¿Qué parte se comieron entre los dos? Como las partes son del mismo tamaño (mismo denominador ${c.d}), sumamos los de arriba: ${c.a} + ${c.b} = ${sum}.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.a}/${c.d} + ${c.b}/${c.d} = ${sum}/${c.d}` },
    { tipo: "hablar", texto: `Así, entre los dos se comieron ${sum}/${c.d} del total: sumar fracciones con el mismo denominador es juntar las partes. Ahora te toca a ti.` },
    { tipo: "hablar", texto: `${c.pHist} ¿Cuánto es en total?` },
    { tipo: "pizarra", accion: "escribir", contenido: `${c.pa}/${c.pd} + ${c.pb}/${c.pd} = ?` },
    { tipo: "preguntar", texto: `¿Cuánto es ${c.pa}/${c.pd} + ${c.pb}/${c.pd}? Escribe la fracción.`, respuesta: `${psum}/${c.pd}`, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "fraccion_resuelta", intencion: "aprender", duracion_estimada: 70, _mock: true, directivas: dir };
}

// ── 3) FACTORIZACIÓN (diferencia de cuadrados) en la vida real: el área que sobra al recortar un
//    cuadrado pequeño de uno grande (x² - b² = (x - b)(x + b), interpretación geométrica). ──
const FACTOR_VIDA = [
  { N: 9, r: 3 }, { N: 16, r: 4 }, { N: 25, r: 5 },
];
export function factorizacionAplicadaLSG(opts = {}) {
  const evit = canonExpr(opts.evitar || "");
  let i = FACTOR_VIDA.findIndex((c) => !evit.includes(`x^2-${c.N}`));
  if (i < 0) i = 0;
  const E = FACTOR_VIDA[i], P = FACTOR_VIDA[(i + 1) % FACTOR_VIDA.length];
  const exprE = `x² - ${E.N}`, exprP = `x² - ${P.N}`;
  const facE = computeFactorization(exprE), facP = computeFactorization(exprP);
  const dir = [
    { tipo: "avatar", accion: "sonreir" },
    { tipo: "hablar", texto: "La factorización por diferencia de cuadrados tiene un significado muy visual: es el área que queda al recortar un cuadrado pequeño de uno grande." },
    { tipo: "hablar", texto: `Imagina una lámina cuadrada de lado x y le recortas un cuadrado de lado ${E.r}. El área que sobra es el cuadrado grande menos el pequeño: x² - ${E.N}.` },
    { tipo: "pizarra", accion: "escribir", contenido: `área sobrante:  ${exprE}` },
    { tipo: "hablar", texto: `Esa misma área se puede reacomodar como un rectángulo. Como ${E.N} es ${E.r}², aplicamos la regla a² - b² = (a - b)(a + b) con a = x y b = ${E.r}.` },
    { tipo: "pizarra", accion: "escribir", contenido: `${exprE} = ${facE}` },
    { tipo: "hablar", texto: `Así, esa área es un rectángulo de lados (x - ${E.r}) y (x + ${E.r}). Factorizar es reescribir la misma cantidad como un producto. Ahora te toca a ti.` },
    { tipo: "hablar", texto: `Recortas un cuadrado de lado ${P.r} de una lámina de lado x. El área sobrante es ${exprP}.` },
    { tipo: "pizarra", accion: "escribir", contenido: exprP },
    { tipo: "preguntar", texto: `¿Cómo se factoriza ${exprP}? Escríbelo como producto de dos paréntesis.`, respuesta: facP, esperar_respuesta: true, si_correcto: "felicitar", si_incorrecto: "mostrar_otro_ejemplo" },
  ];
  return { escena: "factorizacion_resuelta", intencion: "aprender", duracion_estimada: 75, _mock: true, directivas: dir };
}

// ── Detección del tema y despacho al generador correcto ──
// Extrae de un texto una función/monomio simple ("derivada de 5x²" → "5x²"), o null.
function extraerMonomio(texto) {
  const m = String(texto).match(/[+-]?\d{0,3}\s*x\s*(?:\^\s*\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹])?/i);
  return m ? monomioLimpio(m[0].replace(/\s+/g, "")) : null;
}
// Extrae una diferencia de cuadrados factorizable ("...factoriza x² - 9..." → "x² - 9"), o null.
function extraerDifCuadrados(texto) {
  const m = String(texto).match(/[a-z]\s*(?:\^\s*2|[²])\s*-\s*\d+/i);
  return m && computeFactorization(m[0]) ? m[0] : null;
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
  if (["reexplicar", "continuacion", "practicar", "resolver_otro", "mas_facil", "mas_dificil"].includes(seguimiento)) return true;
  const n = normBoton(q);
  if (!n || esSaludoOMetaBoton(n)) return false;
  if (/\bno\s+(lo\s+|la\s+|me\s+|se\s+lo\s+)?(entend|entiend|comprend|capt|pill)/.test(n)) return true;
  if (/explica\w*\s+(lo\s+|me\s+)?(mejor|otra vez|de nuevo|de otra forma|nuevamente|bien)/.test(n)) return true;
  if (/para dummies|mas simple|mas facil de entender|no me queda claro|estoy perdid|me perd[ií]|sigo sin entend|ni idea|no lo veo/.test(n)) return true;
  if (/\botr[oa]\b|\bmas\b|resuelv|de nuevo|otra vez|sigue|contin[uú]a/.test(n)) return true;
  const p = n.split(/\s+/).filter(Boolean).length;
  if (p <= 3 && /(no se|ayud|auxilio|por que|porque)/.test(n)) return true;
  return false;
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

export function leccionBotonLSG({ query = "", seguimiento = "", contexto = "", currentTopic = "", previo = "" } = {}) {
  const SEG_OTRO = new Set(["continuacion", "practicar", "resolver_otro"]);
  // "más fácil"/"más difícil" son seguimientos de NIVEL del tema activo: se mantiene el tema y se cambia
  // la lista de ejercicios a la del nivel pedido (antes caían a Gemini y devolvían algo trivial).
  const SEG_NIVEL = { mas_facil: "facil", mas_dificil: "dificil" };
  const nivel = SEG_NIVEL[seguimiento] || "normal";
  const esSeg = SEG_OTRO.has(seguimiento) || !!SEG_NIVEL[seguimiento];
  // En un seguimiento el tema es el ACTIVO (contexto); en una pulsación nueva, la propia consulta.
  const base = (esSeg && (contexto || currentTopic)) ? (contexto || currentTopic) : query;
  const n = normBoton(base);
  // ¿Es un pedido de ENSEÑAR/APRENDER el tema ("enséñame ecuaciones lineales", "quiero aprender…",
  // "explícame…") en vez de resolver un ejercicio concreto? En ese caso la lección debe empezar por el
  // CONCEPTO y la REGLA (no saltar directo a resolver un ejercicio) — queja del cliente.
  const pideEnsenar = /\bense[nñ]a|\baprend|expl[ií]ca|qu[eé]\s+(es|son)\b|c[oó]mo\s+se\b/.test(n);
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
  if (pideAplicado) {
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
    if (/deriv/.test(nQ) || /velocidad|aceleraci|variaci[oó]n/.test(nQ) || /deriv/.test(ctxTema)) return commonRet("derivada", derivadaAplicadaLSG({ evitar: previo }));
    if (/fracc/.test(tt) || (hayFrac && !hayLineal)) return commonRet("fraccion", fraccionAplicadaLSG({ evitar: previo }));
    if (/factoriz|diferencia de cuadrados/.test(tt) || hayDifCuad) return commonRet("factorizacion", factorizacionAplicadaLSG({ evitar: previo }));
    if (/ecuaci|lineal|primer grado|despej/.test(tt) || hayLineal) return commonRet("lineal", linealAplicadaLSG({ evitar: previo }));
    return null; // aplicado pero sin tema identificable → explicación conceptual la da Gemini (Nivel 2)
  }

  // 1) DERIVADAS. Si nombra una función NO polinómica (trig, log, raíz, eˣ) → null (lo hace Gemini, Nivel 3).
  if (/deriv/.test(n)) {
    if (/\b(sen|sin|cos|tan|cot|sec|csc|log|ln|exp|ra[ií]z|sqrt)\b|√|e\s*\^/.test(n)) return null;
    const instancia = extraerMonomio(base);
    return commonRet("derivada", derivadaResueltaLSG({ evitar: previo, instancia, seguimiento: esSeg, nivel, concepto: !esSeg && pideEnsenar }));
  }

  // 2) FACTORIZACIÓN (diferencia de cuadrados). Con una expresión concreta NO factorizable así
  //    (trinomio, etc.) → null (Gemini). Genérica ("factorizar") o una diferencia de cuadrados → determinista.
  if (/factoriz|diferencia de cuadrados/.test(n)) {
    const instancia = extraerDifCuadrados(base);
    // Hay una expresión con x² pero NO es diferencia de cuadrados factorizable → que lo intente Gemini.
    if (!instancia && /[a-z]\s*(?:\^\s*2|[²])/i.test(base) && !/factoriz/.test(n)) return null;
    if (!instancia && /[a-z]\s*(?:\^\s*2|[²])\s*[+]/i.test(base)) return null; // trinomio "x² + 5x + 6"
    return commonRet("factorizacion", factorizacionResueltaLSG({ evitar: previo, instancia, seguimiento: esSeg, nivel, concepto: !esSeg && pideEnsenar }));
  }

  // 3) FRACCIONES (botón "ejercicio/ejemplo de fracciones", sin una fracción concreta en el texto).
  if (/fracc/.test(n) && !/\d\s*\/\s*\d/.test(base)) {
    const evitarFrac = (String(previo).match(/\d+\s*\/\s*\d+\s*[+\-]\s*\d+\s*\/\s*\d+/) || [])[0] || "";
    // "enséñame fracciones" (sin una fracción concreta) → enseñar el CONCEPTO primero (paridad con lineal).
    return commonRet("fraccion", fraccionResueltaLSG({ evitar: evitarFrac, nivel, concepto: !esSeg && pideEnsenar }));
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
    return commonRet("lineal", linealResueltaLSG({ evitar: previo, instancia: instLin, seguimiento: esSeg, nivel, concepto: !instLin && !esSeg && pideEnsenar }));
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
