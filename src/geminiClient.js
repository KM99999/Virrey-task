// Cliente de Google Gemini para generar el LSG.
// Usa la REST API oficial vía fetch (Node 18+ trae fetch global).
// La clave se lee de process.env.GEMINI_API_KEY — NUNCA se escribe en el código.

import {
  LSG_RESPONSE_SCHEMA,
  buildSystemInstruction,
  mockLSG,
} from "./lsgPrompt.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Google retira modelos concretos cada cierto tiempo (devuelven 404 "no longer
// available"). Para que la app no se rompa por eso, usamos el alias auto-actualizable
// "gemini-flash-latest" y una lista de reserva: si un modelo da 404, se prueba el
// siguiente. El modelo que funcione se recuerda para las siguientes peticiones.
const MODEL_CANDIDATES = [...new Set([
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",       // capaz: genera buenas explicaciones pedagógicas
  "gemini-2.5-flash-lite",  // rápido, reserva si el anterior no está disponible
  "gemini-flash-latest",
  "gemini-2.0-flash",
].filter(Boolean))];

let workingModel = null; // caché del último modelo que respondió bien

/**
 * Genera un LSG para una consulta e intención dadas.
 * Si no hay GEMINI_API_KEY configurada, cae en un generador simulado (mock)
 * para que el prototipo funcione igualmente (útil en desarrollo/demo).
 *
 * @param {string} query  - consulta del alumno.
 * @param {string} intent - intención detectada por el clasificador.
 * @returns {Promise<{ lsg: object, source: "gemini" | "mock", model?: string }>}
 */
export async function generateLSG(query, intent) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return { lsg: mockLSG(query, intent), source: "mock" };
  }

  const body = {
    systemInstruction: { parts: [{ text: buildSystemInstruction(intent) }] },
    contents: [{ role: "user", parts: [{ text: query }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: LSG_RESPONSE_SCHEMA,
      // Desactiva el "thinking" (razonamiento extendido) de los modelos 2.5+: sin
      // esto, gemini-flash-latest tarda >30 s con salida estructurada y da timeout.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // Probar primero el modelo que ya sabemos que funciona.
  const candidates = workingModel
    ? [workingModel, ...MODEL_CANDIDATES.filter((m) => m !== workingModel)]
    : MODEL_CANDIDATES;

  let lastErr = null;
  for (const model of candidates) {
    try {
      const text = await callGemini(apiKey, model, body);
      let lsg;
      try {
        lsg = JSON.parse(text);
      } catch (err) {
        throw new Error(`La respuesta de Gemini no es JSON válido: ${err.message}`);
      }
      workingModel = model; // recordar el modelo que funcionó
      return { lsg, source: "gemini", model };
    } catch (err) {
      lastErr = err;
      // Modelo retirado (404) o lento (timeout) → probar el siguiente candidato.
      if (err.notFound || err.retryable) continue;
      throw err; // cualquier otro error se propaga
    }
  }
  throw lastErr || new Error("Ningún modelo de Gemini está disponible.");
}

// Llama a un modelo concreto. Devuelve el texto de la respuesta, o lanza un error
// (con .notFound = true si el modelo ya no existe, para permitir el fallback).
async function callGemini(apiKey, model, body) {
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  // Timeout defensivo por intento: si el modelo no responde en 25 s, abortamos y
  // dejamos que el fallback pruebe el siguiente (marcado como retryable).
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
    // 404 (NOT_FOUND) = modelo retirado → marcar para el fallback.
    if (res.status === 404 || /not_found|no longer available/i.test(detail)) {
      e.notFound = true;
    }
    throw e;
  }

  const data = await res.json();
  const text = extractText(data);
  if (!text) {
    throw new Error("Gemini no devolvió contenido de texto en la respuesta.");
  }
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
