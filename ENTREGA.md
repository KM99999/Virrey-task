# Entrega técnica — Cierre de Fases 1 y 2 (Math IA)

**Proyecto:** Math IA — tutor de matemáticas web (avatar + pizarra + voz).
**En vivo:** https://math-ia.onrender.com
**Versión final desplegada = entregada:** el commit desplegado es **verificable en vivo** en
`GET /api/health` (campo `version`), y el `.zip` entregado se genera con `git archive` de **ese mismo
commit** → coinciden. (La verificación con Gemini real de abajo se ejecutó sobre este mismo código;
si ve un commit distinto en `/api/health` es solo por cambios de documentación, sin cambios de código
ejecutable — comprobable con `git diff <commit_verificación>..HEAD -- server.js src public`.)
**Fecha:** 2026-07-15.

Este documento cierra los puntos de aceptación acordados (Fases 1 y 2), verificados en producción.

---

## Revisión 2 — puntos solicitados el 2026-07-15

**A. Validación matemática integral** ✅
No solo se corrige la respuesta que califica: ahora el servidor **verifica y corrige TODA operación**
escrita en la pizarra y **dicha por el avatar**. Detecta igualdades aritméticas erróneas (p.ej.
"200 ÷ 25 = 200") y corrige el resultado ("= 8") antes de mostrar la lección; las ecuaciones
algebraicas ("2x + 5 = 15") no se tocan. Código: `corregirIgualdades` en [src/preLight.js](src/preLight.js),
aplicado a cada `hablar` y `pizarra`. Verificado: en la ejecución final, **0 operaciones erróneas** en las 4 lecciones.

**B. Ramificación ligera con ejemplo alternativo resuelto** ✅
Ante un error, además de la pista, se muestra **otro ejemplo PARECIDO resuelto paso a paso** en la
pizarra (narrado por el avatar) y luego se **reabre para reintentar** con el ejercicio propio; si
persiste el error, se refuerza el método **sin revelar la respuesta**. Código: `otroEjemploResuelto`
(servidor, adjunta `otro_ejemplo` a la pregunta) + `_showWorkedExample` en
[public/pseLight.js](public/pseLight.js). *(Las pistas progresivas se mantienen como apoyo adicional;
el ejemplo alternativo resuelto es lo primario, tal como pide el compromiso.)*

**C. Limpieza completa de la sesión** ✅
El botón **"Limpiar historial"** ahora borra el historial visible **y** el tema activo (`lastTopicQuery`)
**y** el contexto que se envía a Gemini (`historial`). Tras limpiar, la siguiente consulta empieza como
**sesión nueva**. Código: handler de `clearHistory` en [public/app.js](public/app.js).

**D. Prueba final verificable (Gemini real, sin demo) + código = desplegado** ✅
- Script reproducible: `node qa/verificar.mjs` (contra producción, **exige Gemini real**, reintenta si
  hay 429). Comprueba las 4 intenciones, la continuidad, las respuestas correctas y la ramificación.
- **Resultado de la ejecución final: 25 verificaciones OK · 0 fallidas** (ver reporte abajo).
- **Código entregado == desplegado:** `GET /api/health` devuelve el `version` (commit) desplegado, y el
  `.zip` se genera con `git archive` de ese mismo commit. Ambos coinciden.

### Reporte de la ejecución final (`node qa/verificar.mjs`, Gemini real)

```
[0] servicio en línea · IA = Gemini (no mock) · versión desplegada = 1895c23 · modelo gemini-2.5-flash-lite
[1] 4 intenciones (Gemini real):
    resolver  "desarrolla 2x + x = 12"            → Gemini ✓ · 4 explicaciones · 1 pregunta · sin operaciones erróneas ✓
    aprender  "enséñame ecuaciones de 1er grado"  → Gemini ✓ · 10 explicaciones · 1 pregunta · sin operaciones erróneas ✓
    explicar  "¿por qué se factoriza x²-9?"       → Gemini ✓ · 6 explicaciones · 1 pregunta · sin operaciones erróneas ✓
    practicar "dame un ejercicio de fracciones"   → Gemini ✓ · 2 explicaciones · 1 pregunta · respuesta correcta 3/5 ✓
[2] continuidad: "explícamelo con manzanas" mantiene el tema (ecuaciones) con manzanas ✓
[3] ramificación: la pregunta incluye un ejemplo alternativo resuelto ✓
─────────────────────────────────────────────────────────────
25 verificaciones OK · 0 fallidas · ✅ VERIFICACIÓN SUPERADA (Gemini real)
```

---

---

## 1. Continuidad conversacional por sesión ✅

La IA recibe el **contexto de la conversación** para entender seguimientos como
*"explícamelo con manzanas"* o *"dame otro ejemplo"* sin perder el tema.

- El frontend envía en cada consulta `currentTopic` (tema activo) e `historial` (últimas consultas).
- El backend los reenvía a Gemini con la instrucción de **mantener el tema** en un seguimiento y
  **cambiar solo** ante un tema nuevo y claro. Detección de seguimiento en **español e inglés**.
- **Verificado en producción:** *"explain using an apple as an example"* sobre *diferencia de
  cuadrados* → sigue en diferencia de cuadrados con manzanas; *"otro ejemplo"* / *"con perritos"*
  mantienen el tema; *"enséñame a sumar"* sí cambia de tema (no queda atrapado).
- Código: [public/app.js](public/app.js), [server.js](server.js), [src/geminiClient.js](src/geminiClient.js).

## 2. Validación matemática ✅

Las respuestas y ejercicios se **verifican antes de mostrarse**. El servidor **calcula la respuesta
él mismo** (aritmética exacta), no confía en la IA (el modelo económico puede equivocarse en cálculo).

- Cubre operaciones, **fracciones exactas**, precedencia/paréntesis, y fórmulas verbales: velocidad,
  área/perímetro, porcentajes, potencias, raíces exactas, promedios, volúmenes.
- Se evita el error tipo *"200 ÷ 25 = 200"*: ahora da 8. Verificado en producción.
- Código: `computeAnswer` / `fixPracticeAnswer` en [src/preLight.js](src/preLight.js).

## 3. Ramificación ligera ✅

Cuando el alumno se equivoca, el sistema ofrece una **pista del método** y permite **reintentar**,
sin repetir el mismo ejercicio a secas **ni revelar la respuesta**.

- 1er error → pista del método (según el tipo: ecuación, fracción, problema verbal) + reintento.
- 2º error → pista más concreta (primer paso) + reintento.
- Si aún falla → recuerda el método y anima a repasar, **sin decir el número** (las pistas ni
  siquiera reciben la respuesta, así que estructuralmente no pueden revelarla).
- Código: `_handleQuestion` + `buildHint` en [public/pseLight.js](public/pseLight.js).

## 4. PRE Light ✅ (implementado y documentado)

El **PRE Light** (`processLSG` en [src/preLight.js](src/preLight.js)) transforma la respuesta cruda
de la IA en **pasos didácticos**: valida y detecta el formato (secuencial para resolver/explicar,
**modular** para aprender/practicar), sanea cada directiva y limpia la notación (LaTeX → texto plano),
numera los pasos, **garantiza una sola pregunta** de práctica calificable, **calcula la respuesta
correcta** y estima la duración. Para "aprender", organiza la lección en módulos
**concepto → regla → ejemplo guiado → práctica**. Documentación completa en la sección
*PRE Light* del [README.md](README.md).

## 5. Manejo transparente de errores ✅

Si Gemini falla por **cuota (429), conexión o respuesta inválida**, la plataforma degrada a **modo
demostración** pero **lo informa con claridad**, sin presentarlo como respuesta normal de la IA:

- Aviso visible en el escenario ("⚠️ Modo demostración. Gemini alcanzó su límite… contenido de
  respaldo, no una respuesta de la IA").
- La píldora de origen muestra **"IA: Gemini"** o **"IA: Modo demostración"** (resaltada).
- Distingue el modo demostración **elegido por el usuario** del **fallo de Gemini**.
- Código: `renderResult` en [public/app.js](public/app.js).

## 6. Validación final y entrega técnica ✅

- **Pruebas con Gemini activo:** `npm run qa` → **120 aprobadas · 0 fallidas · APROBADO**
  (ver reporte abajo). Incluye las 4 intenciones generadas por Gemini real en producción, cada una
  con explicación paso a paso, una sola pregunta y **respuesta correcta**.
- **Versión final desplegada:** commit `76013ee` en `main`.
- **Instrucciones de instalación, despliegue y cambio de clave:** en el [README.md](README.md)
  (secciones *Instalación*, *Despliegue* y *Cambiar la API key de Gemini*).

### Reporte de pruebas (Gemini activo, producción)

```
[desarrolla 2x + x = 12]        intención=resolver ✓ · IA=gemini ✓ · paso a paso ✓ · 1 pregunta ✓ · respuesta correcta (4) ✓
[enséñame ecuaciones de 1er g.] intención=aprender ✓ · IA=gemini ✓ · paso a paso ✓ · 1 pregunta ✓ · respuesta correcta (3) ✓
[¿por qué se factoriza x²-9?]   intención=explicar ✓ · IA=gemini ✓ · paso a paso ✓ · 1 pregunta ✓ · respuesta correcta (3) ✓
[dame un ejercicio de fracc.]   intención=practicar ✓ · IA=gemini ✓ · paso a paso ✓ · 1 pregunta ✓
────────────────────────────────────────────────────────────────────
Aprobadas: 120 · Fallidas: 0 · ✅ APROBADO
```

> Reproducir: `npm run qa` (con `GEMINI_API_KEY` válida). Solo lógica, sin coste: `QA_SKIP_LIVE=1 npm run qa`.
> Nota: las pruebas en vivo toleran un `429` transitorio (aviso, no fallo); las de lógica cubren el código.

---

## Cómo verificarlo usted mismo (en producción)

1. Abrir https://math-ia.onrender.com (primer acceso tras inactividad: ~30-50 s de arranque).
2. **Modo IA** → "Enséñame ecuaciones de primer grado" → Reproducir. Luego "otro ejemplo" o
   "explícamelo con manzanas": mantiene el tema.
3. Responder mal una pregunta de práctica: aparece una **pista**, no la respuesta.
4. Si Gemini está con cuota, aparece el **aviso de modo demostración** (transparente).

El único factor externo es la **cuota/facturación de Gemini**, que corresponde a la cuenta del cliente.
