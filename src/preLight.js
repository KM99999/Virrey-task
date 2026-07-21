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
// Evita CALIFICAR MAL cuando el "match" recorta un coeficiente que iba pegado antes
// (p.ej. "1/2 x = 4" o "3 x = 6" con espacio): en esos casos el valor saldría erróneo.
// Preferimos NO juzgar (modo comprensión) antes que dar un resultado incorrecto.
function tieneCoeficienteRecortado(text, index) {
  const before = text.slice(0, index).replace(/\s$/, ""); // quita UN espacio de separación
  // Rechaza si justo antes hay un dígito/paréntesis/exponente (coeficiente recortado)
  // O una LETRA: eso significa que la "variable" es en realidad la última letra de una
  // palabra (p.ej. "Distanci[a] = 200" o "Tiemp[o] = 25"), no una ecuación. Sin este
  // guardo, "Distancia = 200 metros" se "resolvería" como a = 200 y calificaría 200.
  return /[0-9a-záéíóúñü)/.²³^]$/.test(before);
}

export function solveLinearFromText(text) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  // Ecuación lineal compacta: términos (coef·var o número) unidos por + / -, = número.
  // Captura toda la parte izquierda (varios términos), p.ej. "3x + x", "2x - 3".
  const m = t.match(
    /((?:[+-]\s*)?(?:\d*[a-z]|\d+(?:\.\d+)?)(?:\s*[+-]\s*(?:\d*[a-z]|\d+(?:\.\d+)?))*)\s*=\s*(-?\d+(?:\.\d+)?)(?![a-z0-9.])/
  );
  if (!m) return null;
  if (tieneCoeficienteRecortado(t, m.index)) return null;
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

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };

// Deriva la respuesta de una SUMA/RESTA de fracciones embebida en el texto:
// "a/b + c/d" o "a/b - c/d" → resultado simplificado ("1/3 + 1/6" → "1/2").
// Devuelve la fracción como "n/m" (o entero) o null si no hay una operación así.
export function solveFractionFromText(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/(\d+)\s*\/\s*(\d+)\s*([+\-])\s*(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const n1 = +m[1], d1 = +m[2], op = m[3], n2 = +m[4], d2 = +m[5];
  if (!d1 || !d2) return null;
  const num = op === "+" ? n1 * d2 + n2 * d1 : n1 * d2 - n2 * d1;
  const den = d1 * d2;
  if (den === 0) return null;
  const g = gcd(num, den);
  let sn = num / g, sd = den / g;
  if (sd < 0) { sn = -sn; sd = -sd; }
  return sd === 1 ? String(sn) : `${sn}/${sd}`;
}

// ─── Calculadora determinista de la respuesta ─────────────────────────────────
// La IA (modelo ligero) a veces se EQUIVOCA en aritmética simple (p.ej. "7×3=12") o
// confunde el ejemplo con la práctica. Para GARANTIZAR que la respuesta calificada sea
// correcta sea cual sea la redacción, la calculamos NOSOTROS con aritmética exacta
// (racional) siempre que el ejercicio sea reconocible. No es un marco rígido: cubre
// expresiones explícitas (7×3, 20÷5, 2/5+1/10) y las fórmulas más comunes (velocidad,
// área/perímetro de rectángulo, cuadrado y triángulo). Si no reconoce el ejercicio,
// devuelve null y se usa el resultado que la IA calculó paso a paso.
const rgcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; };
function rat(n, d = 1) { if (d < 0) { n = -n; d = -d; } const g = rgcd(n, d); return { n: n / g, d: d / g }; }
const radd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const rsub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const rmul = (a, b) => rat(a.n * b.n, a.d * b.d);
const rdiv = (a, b) => { if (b.n === 0) throw new Error("÷0"); return rat(a.n * b.d, a.d * b.n); };
function numTok(tok) {
  const neg = tok.startsWith("-");
  const t = tok.replace("-", "");
  const [i, f = ""] = t.split(".");
  const den = Math.pow(10, f.length);
  const n = parseInt((i + f) || "0", 10) * (neg ? -1 : 1);
  return rat(n, den);
}
function fmtRat(r) { return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`; }

// Evalúa una expresión aritmética (números, + - * /, paréntesis) con precedencia, exacta.
function evalExpr(expr) {
  const toks = expr.match(/\d+\.?\d*|[-+*/()]/g);
  if (!toks) return null;
  const out = [], ops = [], prec = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const apply = () => { const op = ops.pop(); const b = out.pop(), a = out.pop(); if (!a || !b) throw new Error("expr");
    out.push(op === "+" ? radd(a, b) : op === "-" ? rsub(a, b) : op === "*" ? rmul(a, b) : rdiv(a, b)); };
  for (const tk of toks) {
    if (/^\d/.test(tk)) out.push(numTok(tk));
    else if (tk === "(") ops.push(tk);
    else if (tk === ")") { while (ops.length && ops[ops.length - 1] !== "(") apply(); ops.pop(); }
    else { while (ops.length && prec[ops[ops.length - 1]] >= prec[tk]) apply(); ops.push(tk); }
  }
  while (ops.length) apply();
  return out.length === 1 ? out[0] : null;
}

// Derivada de un MONOMIO por la regla de la potencia: d/dx(a·xⁿ) = a·n·xⁿ⁻¹.
// Reconoce "derivada de x³", "deriva 3x^2", "d/dx x⁴", etc. Devuelve el resultado SIMBÓLICO
// ("3x²", "2x", "5", "1", "0") o null si no es un monomio en potencia de x (polinomios, senos,
// etc. no se soportan → se devuelve null y NO se califica con un número, en vez de fingir).
export function computeDerivative(text) {
  if (typeof text !== "string") return null;
  let t = text.toLowerCase();
  if (!/deriv|d\s*\/\s*dx/.test(t)) return null;
  // Superíndices Unicode → "^n" para un solo parser.
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join(""));
  // La función a derivar es lo que viene DESPUÉS de "derivada/deriva/d/dx".
  const after = t.split(/deriv\w*|d\s*\/\s*dx/).pop() || "";
  // Solo monomio en x: exactamente UNA 'x'. Con más de una (o polinomio a+b) devolvemos null.
  if ((after.match(/x/g) || []).length !== 1) return null;
  if (/x[\s\^0-9]*[-+]\s*\d*\s*x?/.test(after)) return null; // varios términos → no soportado
  const m = after.match(/(-?\d+(?:\.\d+)?)?\s*\*?\s*x\s*(?:\^\s*(-?\d+))?/);
  if (!m) return null;
  const a = m[1] != null ? Number(m[1]) : 1;
  const n = m[2] != null ? Number(m[2]) : 1;
  if (!Number.isFinite(a) || !Number.isFinite(n)) return null;
  const coef = a * n, exp = n - 1;
  if (coef === 0) return "0";
  if (exp === 0) return String(coef);
  const c = coef === 1 ? "" : coef === -1 ? "-" : String(coef);
  return exp === 1 ? `${c}x` : `${c}x${toSuper(String(exp))}`;
}

// Deriva una FUNCIÓN escrita en la pizarra/enunciado: "f(x) = x³", "y = 2x³" o un monomio suelto
// "x³". Toma el lado DERECHO de "=" (la función real) y aplica la regla de la potencia. Sirve para
// calificar cuando el exponente está en el TABLERO y la pregunta solo dice "¿la derivada de f(x)?".
export function derivarFuncion(expr) {
  if (typeof expr !== "string" || !expr.trim()) return null;
  let s = expr;
  if (s.includes("=")) s = s.split("=").pop(); // RHS: "f(x) = x³" → " x³"
  return computeDerivative("derivada de " + s);
}

// ¿El texto es un MONOMIO LIMPIO en potencia de x, apto para plantear como EJERCICIO de práctica?
// Acepta "x", "x³", "2x⁴", "f(x) = x³". RECHAZA expresiones intermedias/garabateadas que NO deben
// mostrarse como ejercicio: notación de derivada (f'(x)), aproximación (≈), exponentes compuestos
// (x²⁻¹, x^{2-1}), productos con paréntesis (3·(2x…)). Devuelve el monomio limpio ("x³") o null.
// Sirve para no convertir un PASO intermedio del ejemplo en un ejercicio confuso ("deja ejercicios complejos").
export function monomioLimpio(text) {
  if (typeof text !== "string") return null;
  // Notación de DERIVADA (f'(x), y′) o aproximación (≈) → NO es una función limpia para derivar.
  if (/[a-z]\s*['´’′]|≈/i.test(text)) return null;
  // La FUNCIÓN es el lado derecho de "=" (descarta el nombre "f(x) =", que sí es válido).
  const rhs = (text.includes("=") ? text.split("=").pop() : text).trim();
  if (/[{}()·]/.test(rhs)) return null;                          // paréntesis/productos → paso intermedio
  if (/[²³⁴⁵⁶⁷⁸⁹]\s*[⁻⁺]|\^\s*[^0-9]/.test(rhs)) return null;    // exponente compuesto/no numérico
  const r = rhs.replace(/\s+/g, "");
  if ((r.match(/x/gi) || []).length !== 1) return null;
  return /^[+-]?\d{0,3}x(?:\^\d|[²³⁴⁵⁶⁷⁸⁹])?$/.test(r) ? r : null;
}

// Un ejercicio de derivada LIMPIO y SIMPLE (una potencia de x), distinto de los ya escritos en la
// lección, para plantear la práctica cuando en la pizarra solo hay pasos intermedios garabateados.
function ejercicioDerivadaSimple(dirs) {
  const texto = (dirs || []).map((d) => `${d.texto || ""} ${d.contenido || ""}`).join(" ");
  for (const c of ["x⁴", "x⁵", "2x³", "x³", "3x⁴", "x⁶"]) if (!texto.includes(c)) return c;
  return "x⁴";
}

// Calcula la respuesta EXACTA del ejercicio descrito en el texto, o null si no lo reconoce.
export function computeAnswer(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  // Derivada (regla de la potencia) → respuesta simbólica exacta.
  const der = computeDerivative(text);
  if (der != null) return der;
  // Normaliza símbolos y operadores escritos con palabras ("dividido entre", "por", "más"…).
  let norm = text.replace(/×|·/g, "*").replace(/÷/g, "/")
    .replace(/dividido\s+(?:entre|por)/gi, " / ")
    .replace(/multiplicado\s+por/gi, " * ")
    .replace(/(\d)\s*por\s*(\d)/gi, "$1 * $2")
    .replace(/(\d)\s*x\s*(\d)/gi, "$1 * $2")   // "7 x 3" (equis entre dígitos) = multiplicación
    .replace(/(\d)\s*entre\s*(\d)/gi, "$1 / $2")
    .replace(/\bmás\b/gi, " + ").replace(/\bmenos\b/gi, " - ");

  // 1) Expresión aritmética explícita (al menos un operador entre números; admite paréntesis).
  const m = norm.match(/\(?\s*\d+\.?\d*\s*(?:[-+*/]\s*\(?\s*\d+\.?\d*\s*\)?\s*)+/);
  if (m) { try { const r = evalExpr(m[0].replace(/\s+/g, "")); if (r) return fmtRat(r); } catch { /* sigue */ } }

  const low = text.toLowerCase();
  const nums = (low.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(",", ".")));
  const numAt = (i) => numTok(String(nums[i]));
  const entero = (r) => (Number.isInteger(r) ? String(r) : null);

  // 2) Potencias, raíces, porcentajes, promedios (cada uno con su palabra clave distintiva).
  // Potencia con superíndice: "2³" → 8, "5²" → 25.
  const SUP = { "⁰": 0, "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁵": 5, "⁶": 6, "⁷": 7, "⁸": 8, "⁹": 9 };
  const supM = text.match(/(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/);
  if (supM) { const e = [...supM[2]].reduce((a, c) => a * 10 + SUP[c], 0); const r = entero(Math.pow(+supM[1], e)); if (r) return r; }
  // "X al cuadrado" / "X al cubo" / "X elevado a Y" / "X a la (potencia) Y".
  let pw;
  if ((pw = low.match(/(\d+(?:[.,]\d+)?)\s*al\s*cuadrado/))) { const r = entero(Math.pow(Number(pw[1].replace(",", ".")), 2)); if (r) return r; }
  if ((pw = low.match(/(\d+(?:[.,]\d+)?)\s*al\s*cubo/))) { const r = entero(Math.pow(Number(pw[1].replace(",", ".")), 3)); if (r) return r; }
  if ((pw = low.match(/(\d+(?:[.,]\d+)?)\s*(?:elevad[oa]\s*a(?:\s*la)?|a\s*la\s*(?:potencia\s*)?)\s*(\d+)/))) {
    const r = entero(Math.pow(Number(pw[1].replace(",", ".")), Number(pw[2]))); if (r) return r;
  }
  // Raíz cuadrada: solo si es EXACTA (cuadrado perfecto); si es irracional, no adivinamos.
  const rz = low.match(/ra[ií]z\s*(?:cuadrada)?\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/) || text.match(/√\s*(\d+(?:[.,]\d+)?)/);
  if (rz) { const r = Math.sqrt(Number(rz[1].replace(",", "."))); if (Number.isInteger(r)) return String(r); }
  // Porcentaje: "X% de Y" o "X por ciento de Y" → Y·X/100 (exacto).
  const pc = low.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por\s*ciento)\s*de\s*(\d+(?:[.,]\d+)?)/);
  if (pc) { try { return fmtRat(rdiv(rmul(numTok(pc[1].replace(",", ".")), numTok(pc[2].replace(",", "."))), rat(100))); } catch { /* sigue */ } }
  // Promedio / media aritmética de una lista de números.
  if (/promedio|media\s+aritm/.test(low) && nums.length >= 2) {
    try { let s = numAt(0); for (let i = 1; i < nums.length; i++) s = radd(s, numAt(i)); return fmtRat(rdiv(s, rat(nums.length))); } catch { /* sigue */ }
  }
  // Volumen: cubo (lado³) o caja/prisma/ortoedro (largo·ancho·alto).
  if (/volumen/.test(low)) {
    if (/cubo/.test(low) && nums.length >= 1) return String(nums[0] * nums[0] * nums[0]);
    if (/(caja|rectangular|ortoedro|prisma)/.test(low) && nums.length >= 3) return String(nums[0] * nums[1] * nums[2]);
  }

  // 3) Fórmulas de problemas verbales frecuentes.
  const dist = low.match(/(\d+(?:[.,]\d+)?)\s*(?:kil[oó]metros|km|metros|m)\b/);
  const time = low.match(/(\d+(?:[.,]\d+)?)\s*(?:segundos|seg|s|minutos|min|horas|h)\b/);
  if (/velocidad|rapidez/.test(low) && dist && time) {
    try { return fmtRat(rdiv(numTok(dist[1].replace(",", ".")), numTok(time[1].replace(",", ".")))); } catch { /* sigue */ }
  }
  if (/[aá]rea/.test(low)) {
    if (/rect[aá]ngulo/.test(low) && nums.length >= 2) return String(nums[0] * nums[1]);
    if (/cuadrado/.test(low) && nums.length >= 1) return String(nums[0] * nums[0]);
    if (/tri[aá]ngulo/.test(low) && nums.length >= 2) { try { return fmtRat(rdiv(rat(nums[0] * nums[1]), rat(2))); } catch { /* sigue */ } }
  }
  if (/per[ií]metro/.test(low) && /rect[aá]ngulo/.test(low) && nums.length >= 2) return String(2 * (nums[0] + nums[1]));
  if (/per[ií]metro/.test(low) && /cuadrado/.test(low) && nums.length >= 1) return String(4 * nums[0]);
  return null;
}

// Genera los PASOS de resolución de una ecuación lineal simple, para el modo demo
// (sin IA): permite que "2x + x = 12" muestre una solución real paso a paso.
// Devuelve { original, steps:[{explica, escribe}], answer, varName } o null.
export function solveLinearSteps(text) {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase();
  const m = t.match(
    /((?:[+-]\s*)?(?:\d*[a-z]|\d+(?:\.\d+)?)(?:\s*[+-]\s*(?:\d*[a-z]|\d+(?:\.\d+)?))*)\s*=\s*(-?\d+(?:\.\d+)?)(?![a-z0-9.])/
  );
  if (!m) return null;
  if (tieneCoeficienteRecortado(t, m.index)) return null;
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

// ─── Validación matemática INTEGRAL de la lección ─────────────────────────────
// No basta con calificar bien: también hay que verificar las OPERACIONES escritas en la
// pizarra y dichas por el avatar. Esta función detecta igualdades aritméticas "EXPR = RESULT"
// (p.ej. "200 ÷ 25 = 200") y CORRIGE el resultado si está mal ("200 ÷ 25 = 8"). Solo toca
// igualdades cuyo lado izquierdo es una expresión NUMÉRICA pura; las ecuaciones algebraicas
// ("2x + 5 = 15", "x = 5") se dejan intactas (no son igualdades a verificar).
function evalAritToRat(expr) {
  const n = String(expr)
    .replace(/×|·/g, "*").replace(/÷/g, "/").replace(/,/g, ".")
    .replace(/(\d+)\s*²/g, "($1*$1)").replace(/(\d+)\s*³/g, "($1*$1*$1)")
    .replace(/(\d+)\s*⁴/g, "($1*$1*$1*$1)")
    .replace(/\s+/g, "");
  if (/[a-zA-Z]/.test(n)) return null; // tiene variables → no es aritmética pura
  try { return evalExpr(n); } catch { return null; }
}
function rhsToRat(rhs) {
  const s = String(rhs).replace(/,/g, ".").replace(/\s+/g, "");
  const f = s.match(/^(-?\d+)\/(-?\d+)$/);
  if (f) { const d = +f[2]; return d ? rat(+f[1], d) : null; }
  if (/^-?\d+$/.test(s)) return rat(+s, 1);
  if (/^-?\d+\.\d+$/.test(s)) { const neg = s[0] === "-"; const [i, dec] = s.replace("-", "").split("."); const den = Math.pow(10, dec.length); return rat(parseInt(i + dec, 10) * (neg ? -1 : 1), den); }
  return null;
}
export function corregirIgualdades(texto) {
  if (typeof texto !== "string" || !texto.includes("=")) return { texto, correcciones: 0 };
  let correcciones = 0;
  const nuevo = texto.replace(
    /([0-9][0-9\s.,+\-*/×÷·()²³⁴⁵⁶⁷⁸⁹]*[0-9)²³⁴⁵⁶⁷⁸⁹])\s*=\s*(-?[0-9]+(?:[.,][0-9]+)?(?:\s*\/\s*[0-9]+)?)/g,
    (m, lhs, rhs) => {
      if (!/[+\-*/×÷·²³⁴⁵⁶⁷⁸⁹]/.test(lhs)) return m;   // sin operador → no es una operación
      const val = evalAritToRat(lhs);
      if (!val) return m;
      const rv = rhsToRat(rhs);
      if (!rv) return m;
      if (val.n * rv.d === rv.n * val.d) return m;       // ya es correcto
      correcciones++;
      const sep = m.slice(lhs.length, m.length - rhs.length); // el " = " exacto entre lhs y rhs
      return lhs + sep + fmtRat(val);                    // corrige SOLO el resultado (evita tocar el lhs)
    }
  );
  return { texto: nuevo, correcciones };
}

// ─── Ejemplo alternativo RESUELTO (ramificación ligera) ───────────────────────
// Ante un error, además de la pista, se muestra OTRO ejemplo PARECIDO resuelto paso a paso.
// Devuelve { intro, original?, pasos:[{explica,escribe}], cierre } o null si no aplica.
function altEquationFrom(eqText) {
  const v = (String(eqText).toLowerCase().match(/[a-z]/) || ["x"])[0];
  const t = String(eqText).toLowerCase();
  if (/[2-9]\s*[a-z]|\d\d\s*[a-z]/.test(t)) return `3${v} = 12`;  // coeficiente → v = 4
  if (t.includes("-")) return `${v} - 2 = 5`;                     // resta → v = 7
  return `${v} + 4 = 10`;                                         // suma → v = 6
}
const OPS_ALT = [
  { re: /÷|\bdividid|entre\b/, pasos: [{ explica: "Dividir es repartir en partes iguales: 12 entre 4 son 3, porque 3 × 4 = 12.", escribe: "12 ÷ 4 = 3" }] },
  { re: /×|\bmultiplic|\bpor\b/, pasos: [{ explica: "Multiplicar 4 por 3 es sumar 4 tres veces: 4 + 4 + 4 = 12.", escribe: "4 × 3 = 12" }] },
  { re: /\d+\s*\/\s*\d+/, pasos: [{ explica: "Con el mismo denominador, sumamos los numeradores y mantenemos el denominador: 1 + 2 = 3.", escribe: "1/4 + 2/4 = 3/4" }] },
  { re: /-|\bmenos\b|resta/, pasos: [{ explica: "Restar es quitar: a 9 le quitamos 4 y quedan 5.", escribe: "9 - 4 = 5" }] },
  { re: /\+|\bmas\b|suma/, pasos: [{ explica: "Sumar es juntar: 5 y 3 juntos son 8.", escribe: "5 + 3 = 8" }] },
];
export function otroEjemploResuelto(question, board) {
  // 1) Ecuación lineal → generar una ALTERNA similar y resolverla paso a paso.
  const eqText = (board && solveLinearFromText(board) !== null) ? board
    : (solveLinearFromText(question) !== null ? question : null);
  if (eqText) {
    const sol = solveLinearSteps(altEquationFrom(eqText));
    if (sol) {
      return {
        intro: "No pasa nada, así se aprende. Veamos OTRO ejemplo parecido, resuelto paso a paso:",
        original: sol.original,
        pasos: sol.steps,
        cierre: "¿Ves el método? Ahora inténtalo tú otra vez con tu ejercicio.",
      };
    }
  }
  // 2) Aritmética / operación → mostrar una operación similar resuelta.
  const t = `${question || ""} ${board || ""}`.toLowerCase();
  for (const op of OPS_ALT) {
    if (op.re.test(t)) {
      return {
        intro: "No pasa nada. Aquí tienes OTRO ejemplo parecido, resuelto:",
        pasos: op.pasos,
        cierre: "Con esa idea, inténtalo tú de nuevo.",
      };
    }
  }
  return null;
}

// Adjunta a la pregunta de práctica un ejemplo alternativo resuelto (para la ramificación).
function attachAltExample(lsg, pasos) {
  const flat = [];
  if (Array.isArray(lsg.modulos)) for (const m of lsg.modulos) for (const d of m.directivas) flat.push(d);
  else if (Array.isArray(lsg.directivas)) for (const d of lsg.directivas) flat.push(d);
  const qIdx = flat.findIndex((d) => d.tipo === "preguntar");
  if (qIdx === -1) return;
  const q = flat[qIdx];
  if (!(q.respuesta && String(q.respuesta).trim())) return; // sin respuesta calificable, no aplica
  let board = null;
  for (let i = qIdx - 1; i >= 0; i--) { if (flat[i].tipo === "pizarra") { board = flat[i].contenido; break; } }
  const ej = otroEjemploResuelto(q.texto, board);
  if (ej) {
    q.otro_ejemplo = ej;
    const p = pasos.find((x) => x.tipo === "preguntar");
    if (p) p.otro_ejemplo = ej;
  }
}

// ─── Desglose paso a paso del EJERCICIO ACTUAL (continuidad de artefacto) ──────
// Cuando el alumno pide "explícame los pasos anteriores / paso a paso / cómo se resuelve",
// NO hay que generar un ejercicio NUEVO: hay que RE-NARRAR la solución del ejercicio que ya
// está en pantalla. Reconstruimos esos pasos de forma DETERMINISTA (sin llamar a la IA):
//   - ecuación lineal  → `solveLinearSteps` (mismos pasos verificados de la calificación);
//   - aritmética/fórmula → mostramos el ejercicio, el método y el resultado exacto.
// Frase de método según el tipo de operación (breve, sin revelar cuentas ajenas al ejercicio).
function metodoDe(ejercicio) {
  const t = String(ejercicio || "").toLowerCase();
  if (/velocidad|rapidez|distancia|tiempo/.test(t)) return "Aplicamos la fórmula que relaciona los datos (por ejemplo, velocidad = distancia ÷ tiempo) y calculamos con los números del enunciado.";
  if (/[aá]rea|per[ií]metro|volumen/.test(t)) return "Usamos la fórmula de la figura y sustituimos las medidas del enunciado.";
  if (/%|por\s*ciento/.test(t)) return "Un porcentaje se calcula multiplicando la cantidad por el número y dividiendo entre 100.";
  if (/\d+\s*\/\s*\d+/.test(t)) return "Con fracciones buscamos el mismo denominador, operamos los numeradores y simplificamos al final.";
  if (/÷|divid|\bentre\b/.test(t)) return "Dividir es repartir en partes iguales: vemos cuántas veces cabe el segundo número en el primero.";
  if (/×|multiplic|\bpor\b/.test(t)) return "Multiplicar es sumar el mismo número varias veces.";
  if (/-|\bmenos\b|resta/.test(t)) return "Restar es quitar: al primer número le quitamos el segundo.";
  if (/\+|\bm[aá]s\b|suma/.test(t)) return "Sumar es juntar las cantidades.";
  return "Lo resolvemos con calma, paso a paso, aplicando la operación que pide el ejercicio.";
}

// Construye un LSG (secuencial) que NARRA la solución del ejercicio dado, paso a paso.
// `respuesta` (opcional) es la respuesta ya calculada por el PRE Light para ese ejercicio.
// Devuelve un LSG crudo o null si no hay ejercicio.
export function buildStepByStepLSG(ejercicio, respuesta) {
  const ej = str(ejercicio);
  if (!ej) return null;
  const directivas = [
    { tipo: "avatar", accion: "pensando" },
    { tipo: "hablar", texto: "Claro, repasemos juntos —paso a paso— cómo se resuelve este ejercicio." },
  ];
  const lin = solveLinearSteps(ej);
  if (lin) {
    // Ecuación lineal: mostramos el enunciado y CADA paso del despeje (los mismos que valida el sistema).
    directivas.push({ tipo: "pizarra", accion: "escribir", contenido: lin.original });
    for (const p of lin.steps) {
      directivas.push({ tipo: "hablar", texto: p.explica });
      directivas.push({ tipo: "pizarra", accion: "escribir", contenido: p.escribe });
    }
    directivas.push({ tipo: "hablar", texto: `Y así llegamos a la solución: ${lin.varName} = ${lin.answer}.` });
  } else {
    // Aritmética / fórmula / problema verbal: enunciado + método + resultado exacto.
    const ans = str(respuesta) || computeAnswer(ej) || "";
    directivas.push({ tipo: "pizarra", accion: "escribir", contenido: ej.length <= 80 ? ej : "Repasemos el ejercicio" });
    directivas.push({ tipo: "hablar", texto: metodoDe(ej) });
    if (ans) {
      directivas.push({ tipo: "pizarra", accion: "escribir", contenido: `Resultado: ${ans}` });
      directivas.push({ tipo: "hablar", texto: `Siguiendo esos pasos, el resultado es ${ans}.` });
    }
  }
  directivas.push({ tipo: "hablar", texto: "Ese es el procedimiento. Si quieres, lo intentamos ahora con otro ejemplo parecido." });
  return { escena: "desglose_pasos", intencion: "explicar", directivas };
}

// Finaliza el LSG de desglose SIN la maquinaria de práctica (no añade preguntas ni "otro ejemplo"):
// solo numera, sanea (corrige operaciones), arma `pasos` y estima duración. Devuelve
// { lsg, pasos, warnings } o null si no hay ejercicio reconocible.
export function processStepByStep(ejercicio, respuesta) {
  const raw = buildStepByStepLSG(ejercicio, respuesta);
  if (!raw) return null;
  const warnings = [];
  const counter = { n: 0 };
  const pasos = [];
  const directivas = normalizeDirectivas(raw.directivas, counter, warnings, pasos, "desglose");
  if (!directivas.length) return null;
  const lsg = { escena: "desglose_pasos", intencion: "explicar", duracion_estimada: estimateDuration(pasos), directivas };
  return { lsg, pasos, warnings };
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
export function processLSG(rawLsg, intent, mensaje = "") {
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

  // Anti-eco: descarta cualquier "hablar" que sea una REPETICIÓN del mensaje del alumno
  // (a veces la IA "cita" la consulta como si fuera parte de la lección, p.ej. «dame otro ejemplo").»).
  dropEchoedHablar(lsg, mensaje);

  // Garantizar EXACTAMENTE una pregunta en toda la lección (la IA a veces genera
  // varias "preguntar" casi idénticas → dos cajas de respuesta). Si no hay ninguna,
  // se añade una de cierre.
  enforceSingleQuestion(lsg, pasos, counter, intent);

  // Calificación correcta: la respuesta de la pregunta debe ser la del EJERCICIO DE PRÁCTICA
  // escrito en la pizarra (p.ej. "x - 4 = 7" → 11), NO la solución del ejemplo (p.ej. "x = 2").
  // Como red de seguridad, si la IA no rellenó "respuesta", usamos el RESULTADO que ella misma
  // calculó en su borrador "verificacion_respuesta" (funciona para cualquier redacción).
  fixPracticeAnswer(lsg, pasos, rawLsg.verificacion_respuesta);

  // Ramificación ligera: adjunta un ejemplo alternativo RESUELTO para mostrarlo si el alumno falla.
  attachAltExample(lsg, pasos);

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
    case "hablar": {
      let habla = str(raw.texto);
      // Defensa: si la IA repite el andamiaje interno del seguimiento ("Tomé nota de tu consulta…",
      // "Tema: … Mensaje del alumno…"), lo quitamos para que el alumno no lo oiga.
      habla = habla
        .replace(/^\s*tom[ée] nota de tu consulta[:.]?\s*["“']?/i, "")
        .replace(/tema:\s*.*?mensaje del alumno[^:]*:\s*/i, "")
        .trim();
      if (!habla) {
        warnings.push(`"hablar" sin texto descartada en ${context}.`);
        return null;
      }
      // Validación matemática integral: corrige operaciones erróneas también en lo que DICE el avatar.
      const fix = corregirIgualdades(sanitizeMath(habla));
      if (fix.correcciones) warnings.push(`Corregida(s) ${fix.correcciones} operación(es) errónea(s) en "hablar" (${context}).`);
      d.texto = fix.texto;
      break;
    }
    case "esperar":
      d.segundos = clampNumber(raw.segundos, 1, 10, 2);
      break;
    case "pizarra":
      d.accion = str(raw.accion) || "escribir";
      if (!str(raw.contenido)) {
        warnings.push(`"pizarra" sin contenido descartada en ${context}.`);
        return null;
      }
      // Validación matemática integral: corrige operaciones erróneas escritas en la PIZARRA.
      const fixP = corregirIgualdades(sanitizeMath(str(raw.contenido)));
      if (fixP.correcciones) warnings.push(`Corregida(s) ${fixP.correcciones} operación(es) errónea(s) en "pizarra" (${context}).`);
      d.contenido = fixP.texto;
      break;
    case "puntero":
      d.accion = str(raw.accion) || "resaltar";
      if (str(raw.objetivo)) d.objetivo = str(raw.objetivo);
      break;
    case "preguntar": {
      let texto = sanitizeMath(str(raw.texto));
      // La pregunta es UNA sola frase: nos quedamos hasta el primer "?" y descartamos lo que
      // venga después (ejemplos, pistas, "Respuesta: …", saludos). Evita preguntas kilométricas
      // y, sobre todo, que la IA REVELE la respuesta dentro del enunciado.
      const finPregunta = texto.indexOf("?");
      if (finPregunta !== -1) texto = texto.slice(0, finPregunta + 1).trim();
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
      // Si es una pregunta real pero la IA no dio respuesta, intentamos derivarla:
      // primero resolviendo la ecuación lineal embebida ("2x-3=7" → "5") y, si no,
      // una suma/resta de fracciones ("1/3 + 1/6" → "1/2"), para poder calificarla.
      if (!respuesta) respuesta = solveLinearFromText(texto) || solveFractionFromText(texto) || "";
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
// Normaliza texto para comparar "eco" (minúsculas, sin tildes ni signos, espacios colapsados).
function normEcho(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/["'“”¿?¡!.,;:()]/g, "").replace(/\s+/g, " ").trim();
}
// Elimina directivas "hablar" que solo REPITEN el mensaje del alumno (la IA a veces "cita" la
// consulta como si fuera parte de la lección). Evita que el avatar lea la consulta en voz alta.
function dropEchoedHablar(lsg, mensaje) {
  const m = normEcho(mensaje);
  if (m.length < 6) return; // mensaje muy corto → no arriesgar
  const arrays = Array.isArray(lsg.modulos) ? lsg.modulos.map((x) => x.directivas) : [lsg.directivas];
  for (const arr of arrays) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].tipo !== "hablar") continue;
      const h = normEcho(arr[i].texto);
      const esEco = h.length >= 6 && (h === m || (Math.abs(h.length - m.length) <= 6 && (h.includes(m) || m.includes(h))));
      if (esEco) { arr.splice(i, 1); i--; }
    }
  }
}

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
    // La IA a veces escribe el EJERCICIO de práctica como "pizarra" (muchas veces terminando en
    // "?") en lugar de una directiva "preguntar", y entonces no hay pregunta real. Lo recuperamos:
    //  - si una pizarra ES una pregunta (termina en "?"), la usamos como enunciado (y la quitamos
    //    de la pizarra para no duplicarla);
    //  - si es una ecuación resoluble ("2x - 5 = 7"), la planteamos como "resuélvelo tú".
    // Tomamos la ÚLTIMA coincidencia (el ejercicio de cierre).
    // ¿La lección es de DERIVADAS? (algún texto lo menciona) → una función en la pizarra ("f(x) = x³")
    // se plantea como "deriva tú", con respuesta calificable, en vez de una pregunta genérica.
    let esDerivadas = false;
    for (const arr of arrays) for (const d of arr) {
      if (/deriv/i.test(d.texto || "") || /deriv/i.test(d.contenido || "")) { esDerivadas = true; break; }
    }
    const todas = arrays.flat();
    const mostrada = (s) => !!s && todas.some((x) => `${x.contenido || ""} ${x.texto || ""}`.includes(s));
    let promote = null;
    for (const arr of arrays) for (let i = 0; i < arr.length; i++) {
      const d = arr[i];
      if (d.tipo !== "pizarra" || !d.contenido) continue;
      if (/\?\s*$/.test(d.contenido)) { promote = { arr, i, texto: d.contenido, quitar: true }; continue; }
      if (esDerivadas) {
        // Solo un monomio LIMPIO (nunca un paso intermedio garabateado) y cuya derivada NO se haya
        // mostrado ya (si ya se derivó, era el EJEMPLO → mejor un ejercicio nuevo, no repetir).
        const m = monomioLimpio(d.contenido);
        const der = m ? derivarFuncion(m) : null;
        if (m && der && !mostrada(der)) {
          promote = { arr, i, texto: `Ahora deriva tú: ${m}. ¿Cuál es la derivada?`, quitar: false };
        }
        continue; // en lecciones de derivadas no se usa la rama de ecuación lineal
      }
      if (solveLinearFromText(d.contenido) !== null) {
        promote = { arr, i, texto: `Ahora resuélvelo tú: ${d.contenido}. ¿Cuánto vale?`, quitar: false };
      }
    }
    let texto;
    if (promote) {
      texto = promote.texto;
      if (promote.quitar) promote.arr.splice(promote.i, 1); // era una pregunta literal: no duplicar
    } else if (esDerivadas) {
      // Lección de derivadas sin un monomio limpio para practicar → plantea un ejercicio SIMPLE y limpio.
      texto = `Ahora te toca a ti: ¿cuál es la derivada de ${ejercicioDerivadaSimple(todas)}?`;
    } else {
      texto = intent === "aprender" || intent === "practicar"
        ? "¿Te gustaría practicar con otro ejemplo?"
        : "¿Entendiste la explicación?";
    }
    const last = arrays[arrays.length - 1];
    last.push({
      id: ++counter.n,
      tipo: "preguntar",
      texto,
      esperar_respuesta: true,
      si_correcto: intent === "practicar" ? "felicitar" : "continuar",
      si_incorrecto: "mostrar_otro_ejemplo",
    });
  }

  // Reconstruir `pasos` con las directivas resultantes, en orden.
  pasos.length = 0;
  for (const arr of arrays) for (const d of arr) pasos.push({ ...d });
}

// Extrae el RESULTADO que la IA calculó en su borrador "verificacion_respuesta".
// Prioriza la línea "Resultado: <valor>" (formato que exige el prompt); si no está, toma
// el ÚLTIMO número/fracción del texto (el resultado suele ir al final del cálculo).
// Devuelve un string corto ("8", "1/2", "28") o "" si no hay nada aprovechable.
export function resultadoFromVerificacion(v) {
  if (typeof v !== "string" || !v.trim()) return "";
  const num = /-?\d+\s*\/\s*-?\d+|-?\d+(?:[.,]\d+)?/;
  const etiqueta = v.match(/result[a-z]*\s*[:=]\s*([^\n]+)/i);
  if (etiqueta) {
    const m = etiqueta[1].match(num);
    if (m) return m[0].replace(/\s+/g, "").replace(",", ".");
  }
  const todos = v.match(new RegExp(num.source, "g"));
  return todos ? todos[todos.length - 1].replace(/\s+/g, "").replace(",", ".") : "";
}

// La respuesta a calificar debe ser el RESULTADO del EJERCICIO de práctica, sea cual sea su
// redacción. Prioridad:
//   1) Si la pizarra anterior es una ecuación lineal LIMPIA ("x - 4 = 7"), su solución (11) es
//      autoritativa (evita que se copie la del ejemplo, p.ej. "x = 2").
//   2) Si no, y la IA no dejó "respuesta" para una pregunta de CÁLCULO, usamos el resultado que
//      ella misma calculó en "verificacion_respuesta" (velocidad, área, fracciones, etc.).
//   3) En cualquier otro caso, no tocamos nada (respuesta previa o pregunta de comprensión).
function fixPracticeAnswer(lsg, pasos, verificacion) {
  const flat = [];
  if (Array.isArray(lsg.modulos)) for (const m of lsg.modulos) for (const d of m.directivas) flat.push(d);
  else if (Array.isArray(lsg.directivas)) for (const d of lsg.directivas) flat.push(d);

  const qIdx = flat.findIndex((d) => d.tipo === "preguntar");
  if (qIdx === -1) return;
  const q = flat[qIdx];
  const setResp = (val) => {
    q.respuesta = val;
    const p = pasos.find((x) => x.tipo === "preguntar");
    if (p) p.respuesta = val;
  };
  const delResp = () => {
    delete q.respuesta;
    const p = pasos.find((x) => x.tipo === "preguntar");
    if (p) delete p.respuesta;
  };

  // Pizarra (ejercicio) inmediatamente anterior a la pregunta.
  let board = null;
  for (let i = qIdx - 1; i >= 0; i--) { if (flat[i].tipo === "pizarra") { board = flat[i].contenido; break; } }
  // Deriva un MONOMIO LIMPIO del tablero (rechaza pasos intermedios garabateados como
  // "f'(x) ≈ 3·(2x²⁻¹)" y fórmulas con 'n"): devuelve { ejercicio, respuesta } o null.
  const derivadaBoardLimpio = () => {
    const m = monomioLimpio(board);
    const der = m ? computeDerivative("derivada de " + m) : null;
    return der ? { ejercicio: m, respuesta: der } : null;
  };
  const esLeccionDerivadas = flat.some((d) => /deriv/i.test(d.texto || "") || /deriv/i.test(d.contenido || ""));
  // Reescribe la pregunta (texto + respuesta) para calificar el ejercicio del tablero.
  const setPregunta = (texto, val) => {
    q.texto = texto; setResp(val);
    const p = pasos.find((x) => x.tipo === "preguntar");
    if (p) p.texto = texto;
  };

  // Pregunta GENÉRICA de comprensión ("¿entendiste?", "¿te gustaría practicar?"): normalmente no se
  // califica con un número. PERO si hay un EJERCICIO calificable en la pizarra (una derivada de
  // potencia, una ecuación lineal…), calificamos ESE ejercicio en vez de elogiar por participar
  // (evita el defecto: mostrar "f(x)=x³" y dar por buena cualquier respuesta).
  if (/¿?\s*(entendiste|comprendiste|te gustar[ií]a|quieres practicar|alguna duda)/i.test(q.texto)) {
    const dl = derivadaBoardLimpio();
    const lin = board != null ? solveLinearFromText(board) : null;
    if (dl) { setPregunta(`Ahora deriva tú: ${dl.ejercicio}. ¿Cuál es la derivada?`, dl.respuesta); return; }
    if (lin !== null) { setPregunta(`Ahora resuélvelo tú: ${board}. ¿Cuánto vale?`, lin); return; }
    // Lección de derivadas sin ejercicio limpio en la pizarra → plantea uno SIMPLE y limpio.
    if (esLeccionDerivadas) {
      const ej = ejercicioDerivadaSimple(flat);
      setPregunta(`Ahora te toca a ti: ¿cuál es la derivada de ${ej}?`, computeDerivative("derivada de " + ej));
      return;
    }
    delResp();
    return;
  }

  // 0) DERIVADA: si la pregunta pide derivar y la función está en la PIZARRA ("f(x) = x³"), derivamos
  //    la función del tablero (regla de la potencia). Va PRIMERO porque, si no, computeAnswer(q.texto)
  //    sobre "¿la derivada de f(x)?" parsearía "f(x)" y devolvería "1" (incorrecto). Así "2x" a la
  //    derivada de x³ (=3x²) se califica MAL y NO se felicita.
  if (/deriv/i.test(q.texto) || (board && /deriv/i.test(board))) {
    const dl = derivadaBoardLimpio();
    const der = (dl && dl.respuesta) || computeDerivative(q.texto);
    if (der) { setResp(der); return; }
  }

  // 1) Ecuación lineal LIMPIA (en la pizarra o en el propio texto) → solución EXACTA determinista
  //    (p.ej. "x-4=7" → 11); evita copiar la respuesta del ejemplo.
  let eqSol = board != null ? solveLinearFromText(board) : null;
  if (eqSol === null) eqSol = solveLinearFromText(q.texto);
  if (eqSol !== null) { setResp(eqSol); return; }

  // 2) CÁLCULO DETERMINISTA de la respuesta (aritmética exacta / fórmulas). Es la verdad-base:
  //    NO dependemos de que el modelo sepa multiplicar. Cubre 7×3, 20÷5, 2/5+1/10, área, velocidad…
  const comp = computeAnswer(q.texto) ?? (board ? computeAnswer(board) : null);
  if (comp != null) { setResp(comp); return; }

  // 3) Si no reconocemos el ejercicio, usamos el RESULTADO que la IA calculó paso a paso
  //    ("verificacion_respuesta") — último recurso para preguntas de cálculo.
  const esCalculo = /\d/.test(q.texto) ||
    /(cu[aá]nt|cu[aá]l|calcul|resultad|vale|[aá]rea|velocidad|per[ií]metro|suma|resta|divid|multiplic)/i.test(q.texto);
  if (!esCalculo) return;

  const rv = resultadoFromVerificacion(verificacion);
  if (rv) { setResp(rv); return; }

  // 4) Sin nada aprovechable: si aún no hay respuesta, intenta una suma/resta de fracciones.
  if (!(q.respuesta && String(q.respuesta).trim())) {
    const f = solveFractionFromText(q.texto);
    if (f) setResp(f);
  }
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

// Superíndices Unicode para convertir exponentes (x^5 → x⁵, x^{10} → x¹⁰, x^-1 → x⁻¹).
const SUPER = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "n": "ⁿ", "i": "ⁱ" };
const toSuper = (e) => [...e].map((c) => SUPER[c] || c).join("");

// Limpia notación LaTeX / signos de dólar que la IA pueda deslizar, y la convierte
// a texto plano legible (la pizarra y el TTS no renderizan LaTeX). Ej.:
//   "$x^2 - 9 = (x-3)(x+3)$"  →  "x² - 9 = (x-3)(x+3)"
//   "f(x) = x^5"              →  "f(x) = x⁵"
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
    // Exponente con llaves {…} o pegado: cualquier dígito/n/-  → superíndice.
    .replace(/\^\{([^}]+)\}/g, (_, e) => toSuper(e.trim()))
    .replace(/\^(-?[0-9ni]+)/g, (_, e) => toSuper(e))
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
