// Cliente de Google Gemini para generar el LSG.
// Usa la REST API oficial vía fetch (Node 18+ trae fetch global).
// La clave se lee de process.env.GEMINI_API_KEY — NUNCA se escribe en el código.

import {
  LSG_RESPONSE_SCHEMA,
  buildSystemInstruction,
  mockLSG,
} from "./lsgPrompt.js";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Genera un LSG para una consulta e intención dadas.
 * Si no hay GEMINI_API_KEY configurada, cae en un generador simulado (mock)
 * para que el prototipo funcione igualmente (útil en desarrollo/demo).
 *
 * @param {string} query  - consulta del alumno.
 * @param {string} intent - intención detectada por el clasificador.
 * @returns {Promise<{ lsg: object, source: "gemini" | "mock" }>}
 */
export async function generateLSG(query, intent) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return { lsg: mockLSG(query, intent), source: "mock" };
  }

  const model = DEFAULT_MODEL;
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(intent) }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: query }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: LSG_RESPONSE_SCHEMA,
    },
  };

  // Timeout defensivo: si Gemini no responde en 30 s, abortamos en vez de colgar
  // la petición del alumno indefinidamente.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

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
      throw new Error("Gemini no respondió a tiempo (timeout de 30 s).");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(
      `Gemini API error ${res.status}: ${detail.slice(0, 300)}`
    );
  }

  const data = await res.json();
  const text = extractText(data);

  if (!text) {
    throw new Error("Gemini no devolvió contenido de texto en la respuesta.");
  }

  let lsg;
  try {
    lsg = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `La respuesta de Gemini no es JSON válido: ${err.message}`
    );
  }

  return { lsg, source: "gemini" };
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
