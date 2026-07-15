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
const cacheKey = (q, intent, modo) => (modo || "auto") + "::" + intent + "::" + q.toLowerCase().replace(/\s+/g, " ").trim();

// Endpoint principal: recibe { query } y devuelve el LSG procesado.
app.post("/api/query", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  // Contexto de conversación: el último tema, para reexplicar cuando el alumno dice
  // "no entendí". El frontend lo envía solo cuando la consulta es un seguimiento.
  const contexto = typeof req.body?.contexto === "string" ? req.body.contexto.trim().slice(0, 2000) : "";
  // Ajuste de nivel del MISMO tema: "más fácil/básico" o "más difícil" (opcional).
  const ajuste = req.body?.ajuste === "mas_facil" || req.body?.ajuste === "mas_dificil" ? req.body.ajuste : "";
  // Modo elegido por el usuario en la interfaz: "demo" (contenido básico sin IA),
  // "ia" (usa Gemini) o vacío (automático: intenta IA y cae a demo si falla).
  const modo = req.body?.modo === "demo" || req.body?.modo === "ia" ? req.body.modo : "";

  if (!query) {
    return res.status(400).json({ error: "Falta la consulta ('query')." });
  }
  if (query.length > 2000) {
    return res.status(400).json({ error: "La consulta es demasiado larga." });
  }

  try {
    // Seguimiento ("no entendí"): reexplicar el tema anterior de OTRA forma (no repetir).
    const reexplain = !!contexto;
    const effectiveQuery = reexplain ? contexto : query;

    // 1) Intención: si el alumno pide "más fácil/difícil" del mismo tema → "practicar" (un ejercicio
    //    del MISMO tema, más fácil o más difícil). En un "no entendí" → "explicar" (re-enseñar de otra
    //    forma). Si no es seguimiento, la decide el clasificador local.
    const classification = reexplain
      ? ajuste
        ? { intent: "practicar", confidence: 0.9, scores: { resolver: 0, aprender: 0, explicar: 0, practicar: 1 } }
        : { intent: "explicar", confidence: 0.9, scores: { resolver: 0, aprender: 0, explicar: 1, practicar: 0 } }
      : classifyIntent(query);

    // 1.5) Caché: en una reexplicación NO se usa (cada "no entendí" debe poder ser DISTINTO,
    //      para enseñar de otra forma y no repetir como un loro). En lo normal, sí.
    //      La clave incluye el modo: demo e IA se cachean por separado.
    const key = cacheKey(effectiveQuery, classification.intent, modo);
    if (!reexplain && CACHE.has(key)) {
      const cached = CACHE.get(key);
      CACHE.delete(key); CACHE.set(key, cached); // refrescar orden (LRU)
      return res.json({ ...cached, cacheado: true });
    }

    // 2) Generar el LSG. Modo "demo" → contenido básico sin IA; "ia" → SIEMPRE intenta Gemini
    //    (sin bloqueo por enfriamiento); auto (vacío) → intenta IA con enfriamiento tras 429.
    const { lsg: rawLsg, source, model, usage, cached } = await generateLSG(
      effectiveQuery, classification.intent,
      { reexplain, ajuste, forceDemo: modo === "demo", forceAI: modo === "ia" }
    );

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
    // No cachear las reexplicaciones: cada "no entendí" debe poder salir distinto.
    if (!reexplain && ((source === "gemini" && tieneExplicacion) || ecuacionResuelta)) {
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
