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

let workingModel = null;           // último modelo que respondió bien
const knownDead = new Set();        // modelos retirados (404) — persiste entre peticiones
let quotaCooldownUntil = 0;         // tras un 429, no llamamos a Gemini por un rato
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

// Context Caching: nombre del caché del prompt del sistema por modelo (Gemini lo mantiene
// ~1 h). Así el prompt del sistema no se re-cobra como tokens de entrada en cada consulta.
const promptCaches = new Map();      // model -> { name, expireAt }
const cacheUnsupported = new Set();  // modelos donde el caché explícito no está disponible

/**
 * Genera un LSG para una consulta e intención dadas — en UNA sola llamada a la IA.
 * Sin API key, o si Gemini falla, cae en el generador local (mock), que además
 * resuelve ecuaciones lineales. Nunca lanza error al alumno.
 *
 * @param {string} query  - consulta del alumno.
 * @param {string} intent - intención (del clasificador LOCAL).
 * @returns {Promise<{ lsg: object, source: "gemini" | "mock", model?: string }>}
 */
export async function generateLSG(query, intent) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { lsg: mockLSG(query, intent), source: "mock" };

  // Si hace poco Gemini dijo "créditos agotados" (429), no lo llamamos por un rato.
  if (Date.now() < quotaCooldownUntil) {
    return { lsg: mockLSG(query, intent), source: "mock", model: "sin-creditos" };
  }

  // El prompt del sistema es ESTABLE (cacheado); la intención va en el mensaje del usuario.
  const userMsg = `Intención: ${intent}\nConsulta del alumno: ${query}`;

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
      const lsg = await generateOnce(apiKey, model, userMsg);
      workingModel = model;
      return { lsg, source: "gemini", model };
    } catch (err) {
      lastErr = err;
      if (err.quota) { quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS; break; }
      if (err.notFound) { knownDead.add(model); continue; } // retirado → probar el siguiente
      break; // timeout / error / JSON inválido → modo demo (no insistir)
    }
  }

  // Gemini no respondió bien: degradar a modo demo (nunca un error al alumno).
  const quotaHit = !!(lastErr && lastErr.quota);
  return { lsg: mockLSG(query, intent), source: "mock", model: quotaHit ? "sin-creditos" : "demo" };
}

// Una única llamada a Gemini. Usa el caché del prompt del sistema si está disponible;
// si no, envía el prompt inline (los modelos 2.5 igual aplican caché implícito).
async function generateOnce(apiKey, model, userMsg) {
  const cacheName = await getPromptCache(apiKey, model);
  const body = {
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: LSG_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 }, // sin "thinking": más rápido y barato
    },
  };
  if (cacheName) body.cachedContent = cacheName;                          // prompt cacheado
  else body.systemInstruction = { parts: [{ text: SYSTEM_INSTRUCTION }] }; // inline (fallback)

  const text = await callGemini(apiKey, model, body);
  return JSON.parse(text); // si no es JSON válido → lanza (arriba se trata como error → demo)
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
  if (!res.ok) return null; // 400 (prompt corto) / no soportado → sin caché explícito
  const data = await res.json().catch(() => null);
  return data?.name || null; // "cachedContents/xxxx"
}

// Llama a un modelo concreto (generateContent). Devuelve el texto, o lanza un error
// (.notFound si el modelo ya no existe, .quota si se agotó el saldo, .retryable si timeout).
async function callGemini(apiKey, model, body) {
  const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  // Timeout por intento: temas simples responden en ~5-8 s, pero una lección compleja
  // (p.ej. trigonometría) tarda más; damos hasta 25 s antes de caer a modo demo.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

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
    const e = new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 404 || /not_found|no longer available/i.test(detail)) e.notFound = true;
    if (res.status === 429 || /resource_exhausted|credits|quota/i.test(detail)) e.quota = true;
    throw e;
  }

  const data = await res.json();
  const text = extractText(data);
  if (!text) throw new Error("Gemini no devolvió contenido de texto en la respuesta.");
  return text;
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
