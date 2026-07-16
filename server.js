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
import { processLSG, processStepByStep } from "./src/preLight.js";

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
    // Commit git realmente desplegado (Render lo inyecta) → permite comprobar que el código
    // entregado (.zip) es EXACTAMENTE el mismo que está en producción.
    version: process.env.RENDER_GIT_COMMIT || process.env.COMMIT || "desconocido",
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
  // Tipo de seguimiento del tema activo (opcional): reexplicar | mas_facil | mas_dificil | continuacion | desglosar | practicar.
  const SEG_VALIDOS = ["reexplicar", "mas_facil", "mas_dificil", "continuacion", "desglosar", "practicar"];
  const seguimiento = SEG_VALIDOS.includes(req.body?.seguimiento) ? req.body.seguimiento
    : (contexto ? "reexplicar" : ""); // compatibilidad: si hay contexto sin tipo, es un "no entendí"
  // Contexto de conversación: tema activo + últimas consultas del alumno. Se pasa a la IA para que
  // NUNCA interprete el mensaje de forma aislada (evita "bajar" de tema en un seguimiento).
  const currentTopic = typeof req.body?.currentTopic === "string" ? req.body.currentTopic.trim().slice(0, 300) : "";
  const historial = Array.isArray(req.body?.historial)
    ? req.body.historial.filter((s) => typeof s === "string" && s.trim()).slice(-5).map((s) => s.trim().slice(0, 200))
    : [];
  // Resumen de la lección ANTERIOR (memoria): lo ya explicado, para que un "otro ejemplo" no repita.
  const previo = typeof req.body?.previo === "string" ? req.body.previo.trim().slice(0, 500) : "";
  // Continuidad de ARTEFACTO: el EJERCICIO que está en pantalla y su respuesta ya calculada. Se usa
  // cuando el alumno pide "explícame los pasos anteriores / paso a paso" para RE-NARRAR ESE ejercicio
  // (no generar uno nuevo ni cambiar de tema).
  const ejercicio = typeof req.body?.ejercicio === "string" ? req.body.ejercicio.trim().slice(0, 300) : "";
  const respuestaEj = typeof req.body?.respuesta === "string" ? req.body.respuesta.trim().slice(0, 60) : "";
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
    // 0) DESGLOSE PASO A PASO del ejercicio actual (continuidad de artefacto). El alumno pidió
    //    "explícame los pasos anteriores / paso a paso": re-narramos la solución del ejercicio que
    //    YA está en pantalla, de forma DETERMINISTA (sin IA, sin coste). Si no llega un ejercicio
    //    reconocible, seguimos el flujo normal como "reexplicar" (re-enseñar el tema).
    if (seguimiento === "desglosar") {
      const built = processStepByStep(ejercicio, respuestaEj);
      if (built) {
        return res.json({
          query,
          reexplicacion: true,
          intencion: "explicar",
          confianza: 1,
          fuente_ia: "local",          // contenido determinista del PRE Light (no IA, no demo)
          modelo: "pre-light",
          lsg: built.lsg,
          pasos: built.pasos,
          advertencias: built.warnings,
          tokens: null,
          cache_activo: false,
        });
      }
      // sin ejercicio utilizable → cae a "reexplicar" (re-enseñar el tema activo).
    }

    // Seguimiento del tema activo (mantiene el TEMA anterior; no es un tema nuevo).
    const reexplain = !!contexto;
    const esNivel = seguimiento === "mas_facil" || seguimiento === "mas_dificil";
    const esOtraPractica = seguimiento === "practicar"; // "dame otro ejercicio (diferente)" del MISMO tema
    const esContinuacion = seguimiento === "continuacion";
    // effectiveQuery: reexplicar/nivel re-usan el TEMA; "continuación"/"otra práctica" usan el MENSAJE
    // real del alumno (natural) ANCLADO al tema (opts.tema), para que Gemini/demo no pierdan el tema.
    const effectiveQuery = !reexplain ? query
      : esContinuacion ? query
      : esOtraPractica ? query
      : contexto;

    // 1) Intención: "más fácil/difícil" y "otro ejercicio" → practicar (ejercicio del MISMO tema);
    //    "continuación" o "no entendí" → explicar (responder/re-enseñar dentro del tema). Si no es
    //    seguimiento, la decide el clasificador local.
    const classification = reexplain
      ? (esNivel || esOtraPractica)
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
      { reexplain, seguimiento, tema: contexto || currentTopic, currentTopic, historial, previo,
        forceDemo: modo === "demo", forceAI: modo === "ia" }
    );

    // 3) PRE Light: validar y normalizar en bloques predecibles.
    const { lsg, pasos, warnings } = processLSG(rawLsg, classification.intent, effectiveQuery);

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
