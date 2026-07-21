// Cliente de Google Gemini para generar el LSG — optimizado para MÍNIMO consumo:
//   1) SINGLE-SHOT: una sola llamada por consulta (sin reintentos encadenados).
//   2) CONTEXT CACHING: el prompt del sistema (metodología + reglas) se cachea en Gemini,
//      así NO se cobran sus tokens de entrada en cada consulta.
//   3) La clasificación de intención es LOCAL (ver src/classifier.js), no consume IA.
// La clave se lee de process.env.GEMINI_API_KEY — NUNCA se escribe en el código.

import {
  LSG_RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  mockLSG,
} from "./lsgPrompt.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Google retira modelos concretos cada cierto tiempo (404). Si uno está retirado se
// prueba el siguiente UNA vez y se recuerda, para no gastar una llamada en él de nuevo.
const MODEL_CANDIDATES = [...new Set([
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash-lite", // rápido y barato → camino común
  "gemini-2.5-flash",      // reserva si el anterior está retirado
].filter(Boolean))];

// Límite de tokens de SALIDA según la ruta (blindaje de gasto pedido por el cliente):
//   Ruta A — resolución/explicación de un ejercicio (LSG secuencial): respuesta puntual → 1500.
//   Ruta B — enseñar un tema o mini-clase (LSG modular): 5000 → margen amplio para que temas
//     ricos (derivadas, trigonometría) generen la lección COMPLETA sin truncarse. Con 3000 se
//     cortaban justo antes de la práctica → JSON inválido → caían a demo. Con el context caching
//     activo, la entrada cuesta ~50 tokens, así que el coste por lección sigue siendo mínimo.
const RUTA_A = new Set(["resolver", "explicar"]);
const MAX_OUTPUT_RUTA_A = 1500;
const MAX_OUTPUT_RUTA_B = 5000;
const maxOutputTokensFor = (intent) => (RUTA_A.has(intent) ? MAX_OUTPUT_RUTA_A : MAX_OUTPUT_RUTA_B);

let workingModel = null;           // último modelo que respondió bien
const knownDead = new Set();        // modelos retirados (404) — persiste entre peticiones
let quotaCooldownUntil = 0;         // tras un 429, esperamos un poco antes de reintentar
// Un 429 casi siempre es un límite POR MINUTO (RPM/TPM) transitorio, NO falta de saldo:
// se despeja en segundos. Enfriamiento CORTO (20 s) para no bloquear el modo IA cuando sí
// hay cuota; un 429 no cuesta nada. Mientras, el demo tema-consciente cubre.
const QUOTA_COOLDOWN_MS = 20 * 1000;

// Context Caching: nombre del caché del prompt del sistema por modelo (Gemini lo mantiene
// ~1 h). Así el prompt del sistema no se re-cobra como tokens de entrada en cada consulta.
const promptCaches = new Map();      // model -> { name, expireAt }
const cacheUnsupported = new Set();  // modelos donde el caché explícito no está disponible
let lastGeminiError = "";            // último error/estado interno de Gemini (para logs)

/**
 * Genera un LSG para una consulta e intención dadas — en UNA sola llamada a la IA.
 * Sin API key, o si Gemini falla, cae en el generador local (mock), que además
 * resuelve ecuaciones lineales. Nunca lanza error al alumno.
 *
 * @param {string} query  - consulta del alumno.
 * @param {string} intent - intención (del clasificador LOCAL).
 * @returns {Promise<{ lsg: object, source: "gemini" | "mock", model?: string }>}
 */
// Extrae lo que el alumno pide EVITAR en un seguimiento ("otro ejemplo que no sea la velocidad",
// "diferente a X", "sin usar X") → devuelve el concepto a excluir, o "" si no hay ninguno.
function extractExclusion(q) {
  const m = String(q || "").match(
    /(?:diferente[s]? a|distint[oa][s]? a|que no (?:sea|tenga|use|utilice|hable de|incluya|contenga)|sin(?: usar)?|en vez de|en lugar de)\s+(?:la |el |los |las |un |una |lo |de |del )?([\p{L}][\p{L} ]{2,28})/iu
  );
  if (!m) return "";
  return m[1].trim().replace(/\s+(que|para|como|y|en|de|del|al)$/i, "").trim();
}

export async function generateLSG(query, intent, opts = {}) {
  const reexplain = !!opts.reexplain; // "no entendí": enseñar de OTRA forma, no repetir
  // Modo DEMOSTRACIÓN forzado por el usuario: contenido básico instantáneo, sin llamar a la IA.
  if (opts.forceDemo) {
    return { lsg: mockLSG(query, intent, { reexplain }), source: "mock", model: "demo-manual" };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { lsg: mockLSG(query, intent, { reexplain }), source: "mock" };

  // Enfriamiento tras un 429: SOLO en modo automático. Si el usuario eligió MODO IA
  // explícitamente, SIEMPRE intentamos Gemini (no lo bloqueamos por un enfriamiento previo,
  // que es un estado compartido y podría venir de otra consulta reciente).
  if (!opts.forceAI && Date.now() < quotaCooldownUntil) {
    return { lsg: mockLSG(query, intent, { reexplain }), source: "mock", model: "limite-temporal" };
  }

  // El prompt del sistema es ESTABLE (cacheado); la intención va en el mensaje del usuario.
  // Seguimiento del MISMO tema:
  //  - "más fácil/básico" o "más difícil" → mismo tema, ajustando el nivel (NO cambiar de tema).
  //  - "no entendí" → RE-ENSEÑANZA distinta (analogía, más simple), no repetir como un loro.
  const seg = opts.seguimiento; // "reexplicar" | "mas_facil" | "mas_dificil" | "continuacion" | undefined
  let reteach = "";
  if (seg === "mas_facil") {
    reteach = "\n\nIMPORTANTE: el alumno pide algo MÁS BÁSICO del MISMO tema de la consulta. NO cambies de tema bajo ninguna circunstancia (si el tema es ecuaciones, sigue siendo ecuaciones; NO pases a sumar u otro tema). Mantente EXACTAMENTE en ese tema pero baja el nivel: usa números más pequeños y sencillos, ve más despacio y con más detalle, y propón un ejercicio de práctica MÁS FÁCIL del mismo tema.";
  } else if (seg === "mas_dificil") {
    reteach = "\n\nIMPORTANTE: el alumno pide algo MÁS DIFÍCIL del MISMO tema de la consulta. NO cambies de tema. Mantente EXACTAMENTE en ese tema pero sube el nivel: números o casos algo más complejos y un ejercicio de práctica más retador del mismo tema.";
  } else if (seg === "practicar") {
    const tema = opts.tema ? `"${opts.tema}"` : "el de la conversación anterior";
    const evitar = extractExclusion(query);
    const prev = typeof opts.previo === "string" && opts.previo.trim() ? opts.previo.trim().slice(0, 400) : "";
    reteach = `\n\nIMPORTANTE: el alumno pide OTRO EJERCICIO de práctica del MISMO tema (${tema}), NO un tema nuevo. NO cambies de tema bajo ninguna circunstancia (si el tema es derivadas, el ejercicio DEBE ser de derivadas; NO propongas ecuaciones lineales u otro tema). Genera un ejercicio de práctica NUEVO y DISTINTO del mismo tema, con un breve recordatorio del método y una pregunta clara para que lo resuelva el alumno.`
      + (evitar ? ` El alumno pide EVITAR "${evitar}": no repitas ese caso.` : "")
      + (prev ? ` Esto ya se vio antes (propón algo distinto): "${prev}".` : "");
  } else if (seg === "continuacion") {
    const tema = opts.tema ? `"${opts.tema}"` : "el de la conversación anterior";
    const evitar = extractExclusion(query);
    const prev = typeof opts.previo === "string" && opts.previo.trim() ? opts.previo.trim().slice(0, 400) : "";
    reteach = `\n\nIMPORTANTE: el mensaje del alumno es un SEGUIMIENTO del MISMO tema (${tema}), NO un tema nuevo. NO cambies de tema bajo ninguna circunstancia. Responde su mensaje DENTRO de ese tema:\n`
      + `- Si pide "otro ejemplo", una "analogía" o algo "diferente/distinto": ofrece una APLICACIÓN o CONTEXTO NUEVO de la vida real del concepto (NO otro cálculo ni un ejercicio para resolver, salvo que lo pida). Ten VARIEDAD: p.ej. para "derivadas", además de la velocidad puedes usar el crecimiento de una población, el enfriamiento de un café (flujo de calor), el dinero que crece con interés en el banco, la pendiente de una montaña o la rapidez con que sube el agua en un tanque. Elige UNA aplicación distinta y explícala con claridad.\n`
      + (evitar ? `- El alumno pide EVITAR "${evitar}": NO uses ese ejemplo bajo ninguna circunstancia; elige uno claramente distinto.\n` : `- Si pide evitar algo ("que no sea X", "diferente a X", "sin X"), NO uses ese ejemplo.\n`)
      + (prev ? `- Esto YA se explicó antes (NO lo repitas, ofrece algo NUEVO): "${prev}"\n` : "")
      + `- Si pide una ANALOGÍA con un objeto concreto (perritos, manzanas, dinero), úsala manteniendo el tema.\n`
      + `- Si es una pregunta conceptual ("¿eso quiere decir…?"): respóndela clara y directa con un ejemplo.\n`
      + `Empieza DIRECTAMENTE con la explicación real; NUNCA escribas el mensaje del alumno (ni un fragmento de él) como texto de una directiva, y NO uses frases como "Tomé nota de tu consulta". Cierra con una pregunta de práctica del tema.`;
  } else if (reexplain) {
    reteach = "\n\nIMPORTANTE: el alumno dijo que NO ENTENDIÓ. NO repitas las mismas palabras ni el mismo ejemplo; explícalo de OTRA forma. Enséñalo COMO A ALGUIEN QUE NO SABE NADA: parte de una ANALOGÍA cotidiana (comida, dinero, objetos), ve MUY paso a paso y con MUCHO detalle, define cada término, no asumas ningún conocimiento previo y no te saltes pasos. Cuenta o desarrolla lo que haga falta hasta que quede clarísimo, y cierra con un ejercicio más fácil. El objetivo es que POR FIN lo entienda.";
  }
  // Contexto de conversación: el tema activo y las últimas consultas del alumno. Se incluye para que
  // la IA NUNCA interprete el mensaje de forma AISLADA y no "baje" de tema en un seguimiento (p.ej.
  // "enséñame con manzanas" estando en "derivadas" debe seguir siendo derivadas, no sumas).
  const histLista = Array.isArray(opts.historial)
    ? opts.historial.filter((s) => typeof s === "string" && s.trim() && s.trim() !== query.trim())
    : [];
  const ctxLineas = [];
  if (opts.currentTopic) ctxLineas.push(`- Tema activo de la conversación: ${opts.currentTopic}`);
  if (histLista.length) ctxLineas.push(`- Últimas consultas del alumno (de la más antigua a la más reciente): ${histLista.map((s) => `"${s}"`).join(" · ")}`);
  const contextoConv = ctxLineas.length
    ? `\n\nCONTEXTO DE LA CONVERSACIÓN (tenlo en cuenta, no lo repitas en voz alta):\n${ctxLineas.join("\n")}\nSi el mensaje actual es un SEGUIMIENTO (p.ej. "otro ejemplo", "con manzanas", "más fácil", "¿eso quiere decir…?", o pide un EJERCICIO/práctica SIN nombrar un tema nuevo como "déjame un ejercicio" u "otro ejercicio"), MANTENTE en el tema activo (usa ese tema para el ejercicio) y NO bajes a un tema más elemental salvo que el alumno lo pida explícitamente. Si el mensaje introduce un tema NUEVO y claro, cambia a ese tema.`
    : "";
  const userMsg = `Intención: ${intent}\nConsulta del alumno: ${query}${contextoConv}${reteach}`;

  let candidates = (workingModel
    ? [workingModel, ...MODEL_CANDIDATES.filter((m) => m !== workingModel)]
    : MODEL_CANDIDATES).filter((m) => !knownDead.has(m));
  if (candidates.length === 0) candidates = MODEL_CANDIDATES;

  // SINGLE-SHOT: una llamada por consulta. Solo se prueba otro modelo si el primero está
  // retirado (404) — coste puntual que se recuerda (knownDead) para no repetirlo.
  let lastErr = null;
  for (const model of candidates) {
    if (knownDead.has(model)) continue;
    try {
      const { lsg, usage, cached } = await generateOnce(apiKey, model, userMsg, maxOutputTokensFor(intent));
      workingModel = model;
      return { lsg, source: "gemini", model, usage, cached };
    } catch (err) {
      lastErr = err;
      if (err.quota) { quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS; break; }
      if (err.notFound) { knownDead.add(model); continue; } // retirado → probar el siguiente
      break; // timeout / error / JSON inválido → modo demo (no insistir)
    }
  }

  // Gemini no respondió bien: degradar a modo demo (nunca un error al alumno). Se REGISTRA el motivo
  // en el servidor (antes se calculaba en `lastGeminiError` pero nunca se logueaba: sin rastro para
  // diagnosticar una caída — p.ej. clave inválida, cuota, modelo retirado).
  const quotaHit = !!(lastErr && lastErr.quota);
  console.warn(`[Gemini→demo] Fallback a modo demostración. Motivo: ${lastGeminiError || (lastErr && lastErr.message) || "desconocido"}`);
  return { lsg: mockLSG(query, intent, { reexplain }), source: "mock", model: quotaHit ? "limite-temporal" : "demo", motivo: lastGeminiError || undefined };
}

// Una única llamada a Gemini. Usa el caché del prompt del sistema si está disponible;
// si no, envía el prompt inline (los modelos 2.5 igual aplican caché implícito).
async function generateOnce(apiKey, model, userMsg, maxOutputTokens) {
  const cacheName = await getPromptCache(apiKey, model);
  const body = {
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: {
      temperature: 0.2, // bajo: más fiel a las reglas (respuesta correcta, pregunta corta)
      maxOutputTokens, // límite de salida dinámico por ruta (control de gasto)
      responseMimeType: "application/json",
      responseSchema: LSG_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }, // sin "thinking": más rápido y barato
    },
  };
  if (cacheName) body.cachedContent = cacheName;                          // prompt cacheado
  else body.systemInstruction = { parts: [{ text: SYSTEM_INSTRUCTION }] }; // inline (fallback)

  const { text, usage } = await callGemini(apiKey, model, body);
  let lsg;
  try {
    lsg = JSON.parse(text);
  } catch (e) {
    // Respuesta TRUNCADA (lección larga que superó el límite de salida): en vez de perder toda
    // la lección, rescatamos las directivas COMPLETAS y cerramos el JSON. El PRE Light añade la
    // pregunta de cierre si falta. Así una lección de tema avanzado siempre llega utilizable.
    lsg = repararLSGTruncado(text);
    if (!lsg) { lastGeminiError = `JSON inválido no recuperable: …${text.slice(-70)}`; throw e; }
    lastGeminiError = "OK (recuperado de respuesta truncada)";
  }
  return { lsg, usage, cached: !!cacheName };
}

// Repara un LSG JSON truncado: conserva el prefijo con directivas completas y cierra los
// corchetes/llaves abiertos. Devuelve el objeto LSG o null si no se puede recuperar.
function repararLSGTruncado(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const cut = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (cut === -1) return null;
  let t = text.slice(0, cut + 1);
  const st = [];
  let inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") st.push(c);
    else if (c === "}" || c === "]") st.pop();
  }
  t = t.replace(/,\s*$/, "");
  let closers = "";
  for (let i = st.length - 1; i >= 0; i--) closers += st[i] === "{" ? "}" : "]";
  try {
    const obj = JSON.parse(t + closers);
    return obj && typeof obj === "object" && (Array.isArray(obj.directivas) || Array.isArray(obj.modulos)) ? obj : null;
  } catch { return null; }
}

// Devuelve el nombre del caché de contexto del prompt del sistema (o null). Lo crea una
// vez por modelo (Gemini lo mantiene ~1 h). Si el caché no está disponible (p.ej. el
// prompt es más corto que el mínimo cacheable), se recuerda y se usa el prompt inline.
async function getPromptCache(apiKey, model) {
  if (cacheUnsupported.has(model)) return null;
  const cached = promptCaches.get(model);
  if (cached && cached.expireAt > Date.now() + 30_000) return cached.name;
  const name = await createPromptCache(apiKey, model);
  if (name) {
    promptCaches.set(model, { name, expireAt: Date.now() + 55 * 60 * 1000 });
    return name;
  }
  cacheUnsupported.add(model);
  return null;
}

async function createPromptCache(apiKey, model) {
  const url = `${API_BASE}/cachedContents?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${model}`,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        ttl: "3600s",
      }),
      signal: controller.signal,
    });
  } catch {
    return null; // timeout / red → sin caché explícito (se usa inline)
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    return null; // 400 (prompt corto) / no soportado → sin caché explícito
  }
  const data = await res.json().catch(() => null);
  return data?.name || null; // "cachedContents/xxxx"
}

// Llama a un modelo concreto (generateContent). Devuelve el texto, o lanza un error
// (.notFound si el modelo ya no existe, .quota si se agotó el saldo, .retryable si timeout).
async function callGemini(apiKey, model, body) {
  const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  // Timeout por intento: temas simples responden en ~5-8 s, pero una lección de tema
  // avanzado (derivadas, trigonometría) puede generar muchas directivas y tarda 30-40 s;
  // damos hasta 50 s antes de caer a modo demo (con 25 s se cortaban y caían a demo).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      lastGeminiError = "TIMEOUT: Gemini no respondió dentro del límite (lección larga)."; // diagnóstico
      const e = new Error("Gemini no respondió a tiempo (timeout).");
      e.retryable = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    lastGeminiError = `HTTP ${res.status}: ${detail.replace(/\s+/g, " ").slice(0, 260)}`; // diagnóstico temporal
    const e = new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 404 || /not_found|no longer available/i.test(detail)) e.notFound = true;
    if (res.status === 429 || /resource_exhausted|credits|quota/i.test(detail)) e.quota = true;
    throw e;
  }

  const data = await res.json();
  const text = extractText(data);
  if (!text) {
    lastGeminiError = `VACÍO: sin texto. finishReason=${data?.candidates?.[0]?.finishReason || "?"}`; // diagnóstico
    throw new Error("Gemini no devolvió contenido de texto en la respuesta.");
  }
  return { text, usage: data.usageMetadata || null };
}

// Extrae el texto del primer candidato de la respuesta de Gemini.
function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p?.text || "").join("").trim();
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "(sin cuerpo)";
  }
}
