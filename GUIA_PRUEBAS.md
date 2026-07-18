# Math IA — Guía de pruebas (Fases 1 y 2)

**Prototipo:** Math IA · **URL de prueba:** https://math-ia.onrender.com
**Alcance de esta guía:** validar los entregables acordados de la **Fase 1 (núcleo funcional)** y la
**Fase 2 (capa pedagógica visible)**.

Esta guía está pensada para que el cliente pueda **verificar por su cuenta**, paso a paso, que cada
punto acordado funciona. Marque cada casilla al comprobarla.

---

## Antes de empezar

> ### ⏱️ IMPORTANTE — la primera visita puede tardar hasta ~1 minuto
>
> El prototipo está alojado en un **plan gratuito**, que **suspende el servicio tras unos 15 minutos
> sin visitas** para ahorrar recursos. Por eso, **la primera vez que abra el enlace** (o si lleva un
> rato sin usarlo), el servidor tiene que **"despertar"**: la página puede quedarse **en blanco o
> cargando durante 1–2 minutos**.
>
> **Esto es normal y no es un fallo de la aplicación.** Qué hacer:
> 1. Abra https://math-ia.onrender.com y **espere hasta 2 minutos** sin cerrar la pestaña.
> 2. Si sigue en blanco, **recargue la página** (F5) una vez.
> 3. A partir de ahí la aplicación responde **de inmediato** (menos de 2 segundos) mientras la siga usando.
>
> *(Si se desea eliminar por completo esta espera, se requiere un plan de alojamiento de pago; es una
> decisión de coste del cliente, ajena al código del prototipo.)*

- **Navegador:** use **Google Chrome** o **Microsoft Edge**. La *entrada por voz* usa la Web Speech
  API, que **no** está disponible en Firefox.
- **Audio:** los navegadores solo reproducen sonido tras una interacción del usuario; haga **un clic**
  en la página antes de esperar la voz del avatar.
- **Micrófono:** para probar la voz, acepte el permiso de micrófono cuando el navegador lo pida.
- **Dos modos de prueba** (botones arriba del escenario):
  - **Modo demostración** — contenido básico local, **sin usar la IA** (ideal para revisar el flujo,
    la voz y el avatar sin consumo).
  - **Modo IA** — usa la inteligencia artificial (Gemini) para cualquier tema.
- **Orden sugerido:** valide primero la **Fase 1** (punto de control acordado) y luego la **Fase 2**.

---

## FASE 1 — Núcleo funcional

| # | Qué se prueba | Cómo probarlo | Resultado esperado (correcto si…) | ✔ |
|---|---|---|---|---|
| 1 | **Entrada por texto** | Escriba `Resuelve 2x + 5 = 15` y pulse **Enviar** | Se genera una lección; la etiqueta muestra **Intención: resolver** | ☐ |
| 2 | **Entrada por voz** (voz→texto) | Pulse el botón de **micrófono** 🎤 y dicte, p. ej., *"enséñame fracciones"* | El texto dictado aparece en el cuadro de consulta | ☐ |
| 3 | **Manejo de error de voz** | Deniegue el permiso de micrófono e intente dictar | Aparece un mensaje claro (p. ej. *"Permiso de micrófono denegado"*); la aplicación **no** se bloquea | ☐ |
| 4 | **Clasificador de intención — resolver** | `Resuelve 2x + 5 = 15` | Intención detectada: **resolver** | ☐ |
| 5 | **Clasificador — aprender** | `Enséñame derivadas` | Intención detectada: **aprender** | ☐ |
| 6 | **Clasificador — explicar** | `¿Por qué se factoriza x² - 9?` | Intención detectada: **explicar** | ☐ |
| 7 | **Clasificador — practicar** | `Dame un ejercicio de fracciones` | Intención detectada: **practicar** | ☐ |
| 8 | **Integración con la IA** | En **Modo IA**, envíe cualquier consulta | La lección la genera la IA (la etiqueta indica *IA: Gemini*) | ☐ |
| 9 | **Salida estructurada (LSG)** | Pulse **"Ver LSG (JSON)"** | Se muestra un JSON con directivas ordenadas (avatar, hablar, pizarra, esperar, preguntar) y su orden | ☐ |
| 10 | **PRE Light — pasos (resolver)** | Tras `Resuelve 2x + 5 = 15` | La lección aparece como una **secuencia de pasos** ordenados | ☐ |
| 11 | **PRE Light — módulos (aprender)** | Tras `Enséñame derivadas` | La lección aparece organizada en **módulos** (concepto, regla, ejemplo guiado, práctica) | ☐ |

---

## FASE 2 — Capa pedagógica visible

| # | Qué se prueba | Cómo probarlo | Resultado esperado (correcto si…) | ✔ |
|---|---|---|---|---|
| 12 | **Avatar visual 2D** | Genere una lección | Se dibuja el avatar y cambia de gesto (habla, sonríe) | ☐ |
| 13 | **Voz del avatar en español** | Pulse **Reproducir** | Se escucha una voz en **español** narrando la lección | ☐ |
| 14 | **Sincronización (PSE Light)** | Observe durante la reproducción | El contenido aparece en la **pizarra al ritmo** de la narración, paso a paso (no todo de golpe) | ☐ |
| 15 | **Ramificación — respuesta correcta** | En la pregunta de práctica, responda **bien** | El avatar **felicita** y continúa | ☐ |
| 16 | **Ramificación — respuesta incorrecta (un reintento)** | Responda **mal** a la pregunta | Ofrece una **pista o un ejemplo alternativo** y permite **reintentar** (sin revelar la respuesta) | ☐ |
| 17 | **Controles de reproducción** | Use **Reproducir / Pausar / Detener** y la barra de pasos | Funcionan; la barra permite saltar a un paso concreto | ☐ |
| 18 | **Historial de la sesión** | Realice 2–3 consultas | Quedan listadas en **"Historial de la sesión"**; el botón **Limpiar** las borra | ☐ |
| 19 | **Manejo básico de errores** | Elija **Modo demostración** (o si la IA no está disponible) | Se muestra un **aviso claro de modo demostración**, sin presentarlo como respuesta de la IA | ☐ |

---

## Entrega

| # | Qué se prueba | Cómo verificarlo | ✔ |
|---|---|---|---|
| 20 | **Despliegue en ambiente de prueba** | Abra https://math-ia.onrender.com — carga y responde. **Recuerde:** si es la primera visita del día, espere hasta ~2 min a que el servidor despierte (ver aviso al inicio) | ☐ |
| 21 | **Código fuente completo** | Archivo `math-ia-codigo-fuente.zip` (incluye todo el código; **sin** la clave de la IA) | ☐ |
| 22 | **Documentación técnica** | `README.md` (instalación, ejecución y configuración de la API) y `ENTREGA.md` | ☐ |
| 23 | **La clave de la IA está protegida** | La clave (`GEMINI_API_KEY`) vive **solo** en variable de entorno, nunca escrita en el código | ☐ |

*(Trazabilidad opcional para el equipo técnico: `GET /api/health` devuelve el campo `version`, que
coincide con el commit del código entregado — así se comprueba que lo desplegado es exactamente el
código del `.zip`.)*

---

## Notas de alcance

- Los **23 puntos** de esta guía corresponden **exactamente** a los entregables acordados de las
  Fases 1 y 2 del prototipo.
- Para probar el flujo (avatar, voz, sincronización) sin consumir la cuota de la IA, use el
  **Modo demostración**. Reserve el **Modo IA** para confirmar que la IA responde en vivo.
- Funcionalidades más avanzadas que puedan observarse durante la prueba (cálculo automático de
  respuestas complejas, memoria extensa entre mensajes, etc.) son **mejoras adicionales** incluidas
  sin costo y **no forman parte de los criterios de aceptación** del prototipo; corresponden a una
  eventual Fase 2 ampliada.

---

## Conformidad (opcional)

| | |
|---|---|
| **Fase 1 — validada (puntos 1–11):** | ☐ Conforme |
| **Fase 2 — validada (puntos 12–19):** | ☐ Conforme |
| **Entrega — validada (puntos 20–23):** | ☐ Conforme |
| **Fecha de revisión:** | ____________________ |
| **Observaciones:** | ____________________ |

*Documento de pruebas del prototipo Math IA — Fases 1 y 2.*
