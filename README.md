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
  (correcto → felicita · incorrecto → **pista del método + reintento**, sin revelar la respuesta;
  ver *Ramificación ligera*).
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

Cada llamada a Gemini consume saldo. La arquitectura está optimizada para gastar lo mínimo:

- **Single-shot:** **UNA sola llamada** a la IA por consulta (sin llamadas encadenadas ni
  reintentos por clic). La IA resuelve y estructura el LSG en una única respuesta JSON.
- **Clasificador local:** la intención (resolver/aprender/explicar/practicar) se decide con
  **lógica de palabras clave en el código** ([classifier.js](src/classifier.js)) — NO consume IA.
- **Context Caching (Gemini):** el prompt del sistema (metodología + reglas del PRE Light) es
  ESTABLE y se **cachea en Gemini** (`cachedContents`), así sus tokens de entrada **no se cobran**
  en cada consulta (la intención va en el mensaje del usuario). Si el caché no está disponible,
  se envía inline (los modelos 2.5 aplican caché implícito igualmente).
- **Caché de respuestas:** la misma consulta no vuelve a llamar a Gemini (se sirve de memoria).
- **Modelos retirados** se recuerdan → no se gasta una llamada 404 por petición.
- **Enfriamiento por cuota:** un `429` casi siempre es un **límite por minuto** (RPM/TPM) transitorio,
  no falta de saldo. En modo automático la app espera ~20 s antes de reintentar y sirve **modo demo**
  mientras tanto (en **Modo IA** explícito siempre intenta Gemini). Esto evita reintentar en bucle.
- **thinking desactivado** (`thinkingBudget: 0`): sin tokens de razonamiento extendido.

> Si Gemini no responde, la app **no se cae**: degrada a modo demo y **lo avisa con claridad**
> (ver *Manejo transparente de errores*). La facturación/cuota de Gemini es de la cuenta del cliente.

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

## PRE Light — de la respuesta de la IA a pasos didácticos

El **PRE Light** ([`src/preLight.js`](src/preLight.js), función `processLSG`) es la capa que
convierte el LSG **crudo** que devuelve Gemini (que puede venir imperfecto) en bloques
**predecibles y didácticos** que el resto del sistema puede reproducir con seguridad. Sin esta
capa, el PSE Light (Fase 2) no tendría eventos fiables que sincronizar.

**Qué transforma, paso a paso:**

1. **Valida la estructura de la escena** y detecta el formato:
   - **Secuencial** (`directivas: [...]`) para `resolver` / `explicar` — resolución paso a paso.
   - **Modular** (`modulos: [{ id, directivas }]`) para `aprender` / `practicar` — la lección se
     organiza en módulos didácticos: **concepto → regla → ejemplo guiado → práctica** (para
     "aprender") o **recordatorio → práctica** (para "practicar").
2. **Sanea cada directiva** (`sanitizeDirectiva`): verifica el `tipo`, completa campos por defecto,
   descarta las inválidas y **limpia la notación** (`sanitizeMath`): convierte LaTeX/`$` a texto
   plano legible (`x^2` → `x²`, `\frac{a}{b}` → `(a)/(b)`), porque la pizarra y la voz no renderizan LaTeX.
3. **Numera las directivas** (id incremental) para que el PSE Light tenga referencias exactas y pueda
   resaltar el paso activo.
4. **Garantiza UNA sola pregunta de práctica** (`enforceSingleQuestion`): elimina preguntas duplicadas
   y, si la IA escribió el ejercicio como pizarra (a veces sin `preguntar`), lo **recupera** y lo
   convierte en la pregunta real y calificable.
5. **Calcula y verifica la respuesta correcta** (`fixPracticeAnswer` + `computeAnswer`): la respuesta a
   calificar se **calcula de forma determinista en el servidor** (ver *Validación matemática*), no se
   confía ciegamente en la IA. Nunca se muestra un ejercicio con una respuesta errónea.
6. **Estima la duración** de la lección y devuelve además una **lista PLANA de pasos** (útil para el
   render, el transcript y la depuración).

**Módulos didácticos (formato modular).** Para "aprender" un tema, la lección se estructura así:

| Módulo | Contenido |
|---|---|
| `concepto` | Qué es el tema, con un ejemplo cotidiano (la balanza, repartir, etc.). |
| `regla` | La regla o método general, explicado con palabras sencillas. |
| `ejemplo_guiado` | Un ejemplo RESUELTO paso a paso, explicando el porqué de cada paso. |
| `practica` | Cierra con un ejercicio NUEVO (números distintos) para que lo resuelva el alumno. |

Cada módulo empieza con una directiva `hablar` (el porqué) y cada `pizarra` va precedida de su
explicación hablada. El PRE Light valida esta estructura y descarta módulos vacíos.

---

## Validación matemática (la respuesta siempre es correcta)

El modelo económico (`flash-lite`) **puede equivocarse en aritmética simple** (llegó a responder
"7 × 3 = 12"). Por eso **no se confía en la respuesta de la IA**: el servidor **calcula la respuesta
él mismo** con una calculadora determinista de aritmética exacta (`computeAnswer` en `preLight.js`).

- Cubre: operaciones (`+ − × ÷`), **fracciones** exactas (`2/5 + 1/10 = 1/2`), paréntesis y
  precedencia, y fórmulas de problemas verbales: **velocidad** (distancia/tiempo), **área y
  perímetro** (rectángulo, cuadrado, triángulo), **porcentajes**, **potencias**, **raíces exactas**,
  **promedios** y **volúmenes**.
- Si el ejercicio no es reconocible, usa el resultado que la IA calculó **paso a paso** (`Resultado:`)
  como último recurso; y las raíces irracionales **no se adivinan**.
- Resultado: se evita mostrar errores como "200 ÷ 25 = 200". Verificado en producción.

---

## Continuidad conversacional (contexto de sesión)

Para que la IA entienda seguimientos como *"explícamelo con manzanas"* o *"dame otro ejemplo"* sin
perder el tema, el frontend **arrastra el contexto** en cada consulta:

- `currentTopic`: el **tema activo** de la conversación.
- `historial`: las **últimas consultas** del alumno.

El backend los reenvía a Gemini como *contexto de la conversación*, con la instrucción de **mantener
el tema activo** en un seguimiento y **cambiar solo** ante un tema nuevo y claro. Además, un detector
local clasifica el seguimiento (`reexplicar` / `más fácil` / `más difícil` / `otro ejemplo`) — en
**español e inglés**. Así, "con manzanas" sobre *diferencia de cuadrados* sigue siendo diferencia de
cuadrados con manzanas, y no "baja" a sumas.

---

## Ramificación ligera (pista + reintento, sin revelar la respuesta)

Cuando el alumno se equivoca, el sistema **no repite el mismo ejercicio a secas ni revela la
respuesta**. En su lugar (en `pseLight.js`, `_handleQuestion` + `buildHint`):

1. Da una **pista del método** adaptada al tipo de ejercicio (ecuación → "usa la operación inversa";
   fracciones → "fíjate en los denominadores"; problema verbal → "qué fórmula relaciona los datos")
   y **reabre la caja para reintentar**.
2. Si vuelve a fallar, da una **pista más concreta** (el primer paso del método) y permite otro intento.
3. Si aún no acierta, **recuerda el método y anima a repasar** la lección — **sin decir el número**
   de la respuesta. Las pistas nunca contienen la respuesta (la función ni siquiera la recibe).

---

## Manejo transparente de errores

Si Gemini falla por **cuota (429), conexión o respuesta inválida**, la plataforma degrada a **modo
demostración** (contenido local de respaldo) pero **lo informa con claridad**, sin presentarlo como
una respuesta normal de la IA:

- Un **aviso visible** sobre el escenario: *"⚠️ Modo demostración. Gemini alcanzó su límite… Esta
  lección es contenido de respaldo, no una respuesta generada por la IA."*
- La píldora de origen cambia de **"IA: Gemini"** a **"IA: Modo demostración"** (resaltada).
- Se distingue el **modo demostración elegido por el usuario** (aviso neutro) del **fallo de Gemini**
  (aviso de error), para que el alumno siempre sepa qué está viendo.

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

### Cambiar la API key de Gemini

La clave vive **solo** en la variable de entorno `GEMINI_API_KEY` (nunca en el código). Para cambiarla:

- **En local:** edita `.env`, actualiza `GEMINI_API_KEY=...` y reinicia (`npm start`).
- **En Render (interfaz):** servicio → **Environment** → edita `GEMINI_API_KEY` → **Save changes**
  (Render redepliega solo). Comprueba `/api/health` → `{"modo_ia":"gemini"}`.
- **En Render (API), sin abrir la web:**
  ```bash
  # 1) Instala la nueva clave
  curl -X PUT -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$SVC/env-vars/GEMINI_API_KEY" -d '{"value":"NUEVA_CLAVE"}'
  # 2) Dispara un despliegue para que tome la clave
  curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$SVC/deploys" -d '{"clearCache":"do_not_clear"}'
  ```
  (`$SVC` = id del servicio, p.ej. `srv-...`; `$RENDER_API_KEY` = token de Render.)

> **La clave y su facturación son de la cuenta del cliente.** Conviene usar una clave de un
> **proyecto de Google Cloud con facturación activa** (no "Nivel gratuito"), o los `429` serán frecuentes.

---

## Cierre de Fases 1 y 2 — checklist de aceptación

| # | Compromiso | Estado | Dónde |
|---|---|---|---|
| 1 | **Continuidad conversacional** (contexto de mensajes previos para seguimientos) | ✅ | `currentTopic`+`historial` → Gemini · [app.js](public/app.js), [server.js](server.js), [geminiClient.js](src/geminiClient.js) |
| 2 | **Validación matemática** (verificar respuestas/ejercicios antes de mostrarlos) | ✅ | `computeAnswer`/`fixPracticeAnswer` · [preLight.js](src/preLight.js) |
| 3 | **Ramificación ligera** (pista o alternativa + reintento, sin repetir/revelar) | ✅ | `_handleQuestion`+`buildHint` · [pseLight.js](public/pseLight.js) |
| 4 | **PRE Light** documentado (transforma la salida de la IA en pasos y módulos) | ✅ | Sección *PRE Light* de este README · `processLSG` en [preLight.js](src/preLight.js) |
| 5 | **Manejo transparente de errores** (avisar cuando usa modo demostración) | ✅ | Aviso en el escenario · [app.js](public/app.js) `renderResult` |
| 6 | **Validación final y entrega técnica** (pruebas con Gemini, reporte, versión, instrucciones) | ✅ | `npm run qa` (116+/0) · este README · [ENTREGA.md](ENTREGA.md) |

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
