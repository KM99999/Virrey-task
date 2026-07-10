# Math IA — Prototipo web funcional

IA educativa de matemáticas: el alumno consulta por **texto o voz**, el sistema
**clasifica la intención**, una **IA generativa (Google Gemini)** produce una
lección como **LSG (Learning Scene Graph)** — salida estructurada de directivas —
y el **PRE Light** la normaliza en bloques predecibles.

> **Estado: Fases 1 y 2 construidas, verificadas y DESPLEGADAS.**
> 🔗 **Enlace de prueba:** https://math-ia.onrender.com
> La **Fase 2** añade el **avatar visual 2D**, la **voz TTS en español**, el
> **PSE Light** (reproduce el LSG sincronizando voz ↔ pizarra ↔ revelación
> progresiva) y la **ramificación ligera** (un reintento).

---

## Arquitectura (pipeline)

```
Consulta (texto / voz)
        │
        ▼
 Clasificador de intención   →  resolver | aprender | explicar | practicar   (src/classifier.js)
        │
        ▼
 IA generativa (Gemini)      →  genera el LSG con salida estructurada          (src/geminiClient.js + src/lsgPrompt.js)
        │
        ▼
 PRE Light                   →  valida y normaliza el LSG en pasos/módulos     (src/preLight.js)
        │
        ▼
 Frontend                    →  render de pasos + vista JSON + historial        (public/)
```

- **Backend:** Node.js + Express (`server.js`). La **API key vive solo en el
  entorno** (`.env`); el navegador nunca la ve.
- **Frontend:** HTML + CSS + JavaScript vanilla (`public/`). Voz por **Web Speech API**.
- **IA:** Google Gemini vía REST. Si no hay clave, arranca en **modo demo (mock)**
  con LSG simulado para poder probar el flujo completo sin coste.

---

## Requisitos

- **Node.js 18 o superior** (se usa `fetch` nativo).
- Una **API key de Google Gemini** (gratuita): https://aistudio.google.com/app/apikey
- Para la entrada por voz: navegador **Chrome** o **Edge** (Web Speech API).

---

## Instalación

```bash
# 1) Instalar dependencias
npm install

# 2) Configurar la clave de la IA (NUNCA se escribe en el código)
cp .env.example .env       # en Windows PowerShell:  Copy-Item .env.example .env
# Edita .env y pega tu clave en GEMINI_API_KEY=
```

Ejemplo de `.env`:

```
GEMINI_API_KEY=tu_clave_aqui
GEMINI_MODEL=gemini-2.5-flash-lite
PORT=3000
```

> **Modelos de Gemini:** Google **retira modelos con frecuencia** (durante el proyecto
> retiró `gemini-2.0-flash` y `gemini-2.5-flash`). El cliente usa `gemini-2.5-flash-lite`
> por defecto y tiene **fallback automático**: si un modelo devuelve 404, prueba el
> siguiente y recuerda cuál funciona. No hay que tocar código cuando Google cambia algo.

> **Nota de región (importante):** la API de Gemini (`generativelanguage.googleapis.com`)
> **no está disponible en todos los países** — devuelve `400 User location is not supported`
> incluso con facturación activa. Si estás en una región no soportada, el prototipo
> corre en **modo demo (mock)** en local y llama a Gemini real **una vez desplegado en
> una región US** (ver sección *Despliegue*). El código no cambia; solo cambia *desde
> dónde* se hace la llamada.

---

## Ejecución

```bash
npm start          # inicia el servidor
# o, con recarga automática en desarrollo:
npm run dev
```

Abre **http://localhost:3000** en el navegador.

- Escribe una consulta (o pulsa 🎤 para dictarla) y pulsa **Enviar**.
- La cabecera indica el modo: **Gemini** (clave configurada) o **modo demo**.
- Prueba los ejemplos: `Resuelve 2x + 5 = 15`, `Enséñame derivadas`,
  `¿Por qué factorizar x² - 9?`, `Dame un ejercicio de fracciones`.

> **Sin API key:** el prototipo igual funciona en *modo demo* con un LSG simulado,
> útil para validar el flujo. Para respuestas reales, configura `GEMINI_API_KEY`.

---

## Qué se puede validar en la Fase 1

- ✅ Entrada por **texto** y por **voz** (con manejo de errores de reconocimiento).
- ✅ **Clasificador** que distingue las 4 intenciones (se muestra intención + confianza).
- ✅ **Integración con la IA** (Gemini) y **salida en LSG**.
- ✅ **PRE Light** normalizando el LSG (pasos numerados, cierre con pregunta, avisos).
- ✅ Vista del **LSG en JSON** e **historial** de la sesión.

### Fase 2 (capa pedagógica visible)

- ✅ **Avatar 2D** con estados (neutral, hablando, sonriendo, preguntando) y boca animada.
- ✅ **Voz TTS en español** (elige voz `es-ES` si el navegador la tiene; si no, subtítulos temporizados).
- ✅ **PSE Light:** pulsa **▶ Reproducir**; ejecuta el LSG directiva por directiva
  sincronizando la voz del avatar con la revelación del contenido en la pizarra y el
  resaltado con puntero.
- ✅ **Ramificación ligera:** en cada `preguntar`, el alumno responde; se evalúa
  (correcto → continúa/felicita · incorrecto → otro ejemplo + **un reintento**).
- ✅ Resaltado del **paso activo** en el transcript durante la reproducción.

> **Voz:** requiere **Chrome/Edge** (mejor soporte de voces en español). El escenario
> también funciona en **modo demo (mock)** sin API key.

---

## Metodología de enseñanza

El corazón de la app es *cómo* enseña, no solo *qué* responde. El prompt fuerza a la IA a:

- **Explicar el porqué de cada paso** con voz (`hablar`) **antes** de escribirlo en la
  pizarra — nunca vuelca la solución sin razonarla.
- Cerrar con **un ejercicio NUEVO de práctica** (números distintos), nunca preguntar por
  un valor que ya está en la pizarra.
- Una **sola pregunta** por lección, con su respuesta correcta (el backend la deduce
  resolviendo la ecuación si la IA no la da), para evaluar bien al alumno.

El backend **verifica la calidad**: si la IA devuelve una lección sin explicaciones,
la rechaza y reintenta (hasta obtener una con explicaciones).

---

## Control de consumo de la API (importante)

Cada llamada a Gemini consume saldo. El sistema minimiza el gasto:

- **Caché:** la misma consulta no vuelve a llamar a Gemini (se sirve de memoria).
- **Modelos retirados** se recuerdan → no se gasta una llamada 404 por petición.
- **Enfriamiento por cuota:** si Gemini responde `429` (saldo agotado), la app deja de
  llamarlo por 5 min y sirve **modo demo**, en vez de reintentar en bucle.
- Reintentos internos acotados a 2.

> Si el saldo se agota, la app **no se cae**: degrada a modo demo (píldora "demo/mock").
> Para reactivar la IA real, recarga créditos en Google AI Studio.

---

## QA — control de calidad antes de entregar

```bash
npm run qa                     # lógica + lecciones reales en producción → APROBADO/RECHAZADO
QA_SKIP_LIVE=1 npm run qa       # solo lógica (no consume saldo de Gemini)
QA_URL=http://localhost:3137 npm run qa   # contra otra URL
```

`qa/qa.mjs` verifica, para las 4 intenciones, que la lección **explique paso a paso**,
tenga **una sola pregunta** con **respuesta correcta**, y no contenga LaTeX ni `$`.
Falla (exit 1) si algo no pasa. **Correr antes de cada entrega.**

---

## El formato LSG (Learning Scene Graph)

La IA devuelve una escena compuesta por **directivas discretas** (cada acción es un
evento). Dos formas según la intención:

- **Secuencial** (`resolver` / `explicar`): campo `directivas: [...]`.
- **Modular** (`aprender` / `practicar`): campo `modulos: [{ id, directivas }]`.

Tipos de directiva: `avatar`, `hablar`, `esperar`, `pizarra`, `puntero`, `preguntar`
(esta última con ramificación `si_correcto` / `si_incorrecto`).

Ejemplo — "Resuelve 2x + 5 = 15":

```json
{
  "escena": "resolver_ecuacion",
  "intencion": "resolver",
  "duracion_estimada": 60,
  "directivas": [
    { "id": 1, "tipo": "hablar", "texto": "Restamos 5 en ambos lados para despejar el término con x." },
    { "id": 2, "tipo": "pizarra", "accion": "escribir", "contenido": "2x = 10" },
    { "id": 3, "tipo": "hablar", "texto": "Ahora dividimos entre 2 para dejar la x sola." },
    { "id": 4, "tipo": "pizarra", "accion": "escribir", "contenido": "x = 5" },
    { "id": 5, "tipo": "preguntar", "texto": "Ahora tú: ¿cuánto vale x en x + 3 = 7?",
      "respuesta": "4", "esperar_respuesta": true, "si_correcto": "felicitar",
      "si_incorrecto": "mostrar_otro_ejemplo" }
  ]
}
```

---

## Estructura del proyecto

```
.
├─ server.js              # Servidor Express + endpoint /api/query
├─ src/
│  ├─ classifier.js       # Clasificador de intención (4 intenciones)
│  ├─ geminiClient.js     # Integración con Gemini (+ fallback mock)
│  ├─ lsgPrompt.js        # Esquema LSG + prompt + generador simulado
│  └─ preLight.js         # PRE Light: validación/normalización del LSG
├─ public/
│  ├─ index.html          # UI (escenario Fase 2 + paneles Fase 1)
│  ├─ styles.css          # Estilos
│  ├─ app.js              # Texto/voz, backend, render, historial + wiring del escenario
│  ├─ avatar.js           # Fase 2: avatar 2D (SVG) con estados
│  ├─ tts.js              # Fase 2: voz TTS en español (SpeechSynthesis)
│  └─ pseLight.js         # Fase 2: PSE Light (sincronización) + ramificación ligera
├─ qa/
│  └─ qa.mjs              # Control de calidad (npm run qa): lógica + producción real
├─ render.yaml            # Blueprint de despliegue (Render, región US)
├─ .env.example           # Plantilla de configuración (copiar a .env)
├─ .gitignore             # Ignora node_modules y .env
└─ package.json
```

---

## Seguridad

- La **API key** se lee de variables de entorno (`process.env.GEMINI_API_KEY`) y
  **nunca** se incluye en el código ni se envía al navegador.
- El archivo `.env` está en `.gitignore`: no se sube al repositorio.

---

## Despliegue (Render — región US)

El backend guarda la API key y llama a Gemini; desplegándolo en una **región US** la
llamada funciona aunque tu ubicación esté bloqueada. El repo incluye
[`render.yaml`](render.yaml) (blueprint listo).

**Pasos:**

1. **Sube el código a GitHub** (requerido por Render y por el entregable):
   ```bash
   git init && git add . && git commit -m "Math IA — Fase 1"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/math-ia.git
   git push -u origin main
   ```
   > `.env` **no** se sube (está en `.gitignore`); la clave se configura en Render.

2. **Crea el servicio en Render:**
   - Entra a https://render.com → **New +** → **Blueprint**.
   - Conecta tu cuenta de GitHub y elige el repo `math-ia`.
   - Render lee `render.yaml` y crea un Web Service en **Oregon (US)**.

3. **Configura la clave secreta:**
   - En el servicio → **Environment** → añade `GEMINI_API_KEY` con tu clave.
   - (`GEMINI_MODEL` y `NODE_VERSION` ya vienen del blueprint.)

4. **Deploy.** Render instala (`npm install`) y arranca (`npm start`). El health
   check `/api/health` debe responder `{"modo_ia":"gemini"}`. Tu enlace de prueba
   queda en `https://math-ia.onrender.com` (o el nombre que asigne Render).

> El puerto lo asigna Render vía `PORT` (el servidor ya lo respeta). El plan `free`
> "duerme" tras inactividad; la primera petición tras dormir tarda unos segundos.

---

## Estado y pendientes

- ✅ **Fase 1** (núcleo funcional) — construida y verificada.
- ✅ **Fase 2** (capa pedagógica visible) — avatar, voz TTS, PSE Light y ramificación,
  verificados (tests de lógica + integración DOM + render en navegador).
- ✅ **Gemini real verificado** en producción (región US) — genera lecciones con
  explicaciones, una pregunta y respuesta correcta.
- ✅ **Desplegado y en vivo:** https://math-ia.onrender.com
- 🔑 **Requiere saldo de Gemini** para la IA real; sin saldo degrada a modo demo.
- ℹ️ **Cold-start (plan free):** el servicio "duerme" tras inactividad; la primera
  carga puede tardar ~30-50 s. Se elimina con un *keep-warm* (ping periódico) o plan de pago.
```
