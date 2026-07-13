// Math IA — servidor (Fase 1: núcleo funcional).
// Sirve el frontend estático y expone /api/query, que ejecuta el pipeline:
//   consulta → clasificador de intención → IA (Gemini, LSG) → PRE Light → respuesta.
//
// La API key vive SOLO en variables de entorno (.env), nunca en el código ni en
// el frontend. El navegador nunca ve la clave: habla con este backend.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyIntent } from "./src/classifier.js";
import { generateLSG } from "./src/geminiClient.js";
import { processLSG } from "./src/preLight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Salud del servicio y si hay API key configurada (sin revelarla).
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    modo_ia: process.env.GEMINI_API_KEY ? "gemini" : "mock",
    modelo: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
  });
});

// Caché de lecciones en memoria: la MISMA consulta no vuelve a llamar a Gemini
// (el mayor ahorro de créditos — al probar se repiten mucho las mismas consultas).
const CACHE = new Map(); // clave -> respuesta ya generada
const CACHE_MAX = 300;
const cacheKey = (q, intent) => intent + "::" + q.toLowerCase().replace(/\s+/g, " ").trim();

// Endpoint principal: recibe { query } y devuelve el LSG procesado.
app.post("/api/query", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  // Contexto de conversación: el último tema, para reexplicar cuando el alumno dice
  // "no entendí". El frontend lo envía solo cuando la consulta es un seguimiento.
  const contexto = typeof req.body?.contexto === "string" ? req.body.contexto.trim().slice(0, 2000) : "";

  if (!query) {
    return res.status(400).json({ error: "Falta la consulta ('query')." });
  }
  if (query.length > 2000) {
    return res.status(400).json({ error: "La consulta es demasiado larga." });
  }

  try {
    // Si es un SEGUIMIENTO ("no entendí"), reexplicamos el tema anterior de forma más
    // simple. La consulta efectiva (para clasificar y generar) apunta a ese tema.
    const effectiveQuery = contexto
      ? `Explícame otra vez, de forma más simple y con otro ejemplo distinto, el tema: ${contexto}`
      : query;

    // 1) Clasificar la intención (una de las 4).
    const classification = classifyIntent(effectiveQuery);

    // 1.5) ¿Ya generamos esta consulta? → servir de caché (0 llamadas a Gemini).
    const key = cacheKey(effectiveQuery, classification.intent);
    if (CACHE.has(key)) {
      const cached = CACHE.get(key);
      CACHE.delete(key); CACHE.set(key, cached); // refrescar orden (LRU)
      return res.json({ ...cached, query, reexplicacion: !!contexto, cacheado: true });
    }

    // 2) Generar el LSG con la IA (o mock si no hay clave).
    const { lsg: rawLsg, source, model, usage, cached } = await generateLSG(effectiveQuery, classification.intent);

    // 3) PRE Light: validar y normalizar en bloques predecibles.
    const { lsg, pasos, warnings } = processLSG(rawLsg, classification.intent);

    const payload = {
      query,
      reexplicacion: !!contexto, // true si fue un "no entendí" (reexplicación del tema anterior)
      intencion: classification.intent,
      confianza: classification.confidence,
      fuente_ia: source, // "gemini" | "mock"
      modelo: model,     // modelo de Gemini realmente usado (diagnóstico/QA)
      lsg,
      pasos,
      advertencias: warnings,
      tokens: usage || null, // consumo de tokens de Gemini (entrada/salida/cacheados)
      cache_activo: !!cached, // ¿se usó el Context Caching del prompt del sistema?
    };

    // Cachear lecciones reales con explicaciones, o ecuaciones ya resueltas por el modo
    // demo (contenido correcto), para que repetir la misma consulta sea instantáneo.
    const tieneExplicacion = pasos.some((p) => p.tipo === "hablar");
    const ecuacionResuelta = source === "mock" && lsg.escena === "demo_resuelto";
    if ((source === "gemini" && tieneExplicacion) || ecuacionResuelta) {
      CACHE.set(key, payload);
      if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value); // desalojar el más viejo
    }

    return res.json(payload);
  } catch (err) {
    console.error("[/api/query] Error:", err.message);
    return res.status(502).json({
      error: "No se pudo generar la lección.",
      detalle: err.message,
    });
  }
});

app.listen(PORT, () => {
  const modo = process.env.GEMINI_API_KEY ? "Gemini (API real)" : "MOCK (sin API key)";
  console.log(`\n  Math IA — Fase 1 escuchando en http://localhost:${PORT}`);
  console.log(`  Modo IA: ${modo}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log("  → Configura GEMINI_API_KEY en .env para usar la IA real.\n");
  } else {
    console.log("");
  }
});
