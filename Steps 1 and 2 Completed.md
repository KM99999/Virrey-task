# Fases 1 y 2 — Completadas

**Proyecto:** Math IA — Prototipo web funcional de tutor de matemáticas (avatar + pizarra + voz).
**Periodo:** 9 de julio – 24 de agosto de 2026 · **222 commits**.
**Estado:** Fases 1 y 2 **completas, verificadas y desplegadas**.
**Versión entregada:** commit `e96a544dd29ef9ea2d9b421c90f33fce2de7b021`.
**En vivo:** https://math-ia.onrender.com — `/api/health` devuelve ese mismo hash, de modo que el
código entregado y el que está funcionando son contrastables uno contra otro.

> Este documento recoge **qué se construyó** en las Fases 1 y 2. El registro cronológico completo del
> desarrollo, etapa por etapa, está en `Milestone.md`. La guía para comprobarlo punto por punto está
> en `GUIA_ACEPTACION.md`.

---

## 1. Alcance contratado y su cumplimiento

Las trece funcionalidades de la publicación original, una a una:

| Funcionalidad solicitada | Estado | Dónde vive |
|---|---|---|
| Página web simple y completamente funcional | ✅ entregada | `public/` |
| Avatar visual básico | ✅ entregado | `public/avatar.js` |
| Entrada de texto para consultas matemáticas | ✅ entregada | `public/app.js` |
| Entrada de voz con conversión de voz a texto | ✅ entregada | Web Speech API (`public/app.js`) |
| Integración por API con IA generativa | ✅ entregada | Google Gemini (`src/geminiClient.js`) |
| Clasificador de intención: resolver · aprender · explicar · practicar | ✅ las cuatro | `src/classifier.js` |
| **PRE Light** — pasos didácticos (ejercicios) o módulos (temas) | ✅ entregado | `src/preLight.js` |
| **PSE Light** — voz sincronizada con la aparición progresiva | ✅ entregado | `public/pseLight.js` |
| Voz del avatar en español | ✅ entregada | `public/tts.js` |
| Historial de la sesión | ✅ entregado | `public/app.js` |
| Manejo básico de errores | ✅ entregado | servidor y frontend |
| Despliegue en ambiente de prueba | ✅ entregado | Render |
| Código fuente y documentación técnica | ✅ entregados | repositorio público |

---

## 2. Arquitectura entregada

```
consulta (texto o voz)
   ↓
clasificador de intención  ......  resolver · aprender · explicar · practicar
   ↓
¿tema garantizado?
   ├── SÍ  → motor determinista (sin IA, sin coste, siempre exacto)
   └── NO  → Gemini con salida estructurada (LSG)
   ↓
PRE Light  ..........  valida la matemática, corrige igualdades, estructura la lección
   ↓
PSE Light  ..........  sincroniza la voz del avatar con la pizarra paso a paso
```

**Decisión de arquitectura central:** en los temas garantizados **el resultado no lo calcula la IA**,
lo calcula el propio sistema con aritmética exacta. La IA no puede equivocarse en aquello que no
calcula. Esa decisión es la que sostiene el criterio de "cero alucinaciones en respuestas
calificadas".

---

## 3. Temas garantizados

Cinco temas se enseñan **sin depender de la IA**, con el resultado calculado y verificado por el
servidor, en tres niveles (fácil · normal · difícil):

1. **Ecuaciones lineales** — incluidas las de paréntesis, x en ambos lados, denominador y coeficiente decimal.
2. **Derivadas de polinomios** — regla de la potencia, término a término.
3. **Factorización** — diferencia de cuadrados.
4. **Fracciones** — suma con igual y distinto denominador.
5. **Aritmética básica** — suma, resta, multiplicación y división.

Cada tema se enseña en varios registros: **concepto**, **partes** (cómo se llama cada pieza),
**ejercicio resuelto**, **práctica calificable** y **problema de la vida real**.

### Estructura modular de las lecciones de tema

Toda lección con intención **aprender** se entrega en los cuatro módulos pactados y en este orden:

```
concepto  →  regla / propiedades  →  ejemplo_guiado  →  practica
```

La garantía vive en el **PRE Light**, no en el prompt: si la lección la redacta la IA (un tema fuera
del motor determinista) y devuelve otros nombres de módulo, el PRE Light los renombra, los funde, los
ordena y coloca la pregunta calificable en el módulo de práctica. Si algún módulo faltara, lo registra
en `advertencias`; **no lo rellena con contenido inventado**.

---

## 4. Comportamiento de clase

- **La clase continúa sola.** Al acertar un ejercicio el tutor enlaza el tramo siguiente: primero las
  partes del tema, luego ejercicios, subida de nivel al acertar dos seguidos y ejemplos de la vida
  real cada tercer tramo, hasta un tope de 12 tramos.
- **"No entendí" tiene escalera.** Cada repetición baja un escalón de simplificación; al tercero
  además baja la dificultad del ejercicio.
- **El nivel y el modo se recuerdan** entre turnos, guardados como estado y no deducidos del texto anterior.
- **Rotación sin repeticiones**: un cursor explícito por tema y nivel recorre la lista entera de
  ejemplos antes de repetir ninguno.
- **"Sí" y "no"** son respuestas a la pregunta del tutor y nunca cambian de tema.
- **Nunca se califica lo que no se ha podido calcular**: sin verificación no hay nota, para no marcar
  como incorrecta una respuesta correcta.

---

## 5. Estado verificado

| Prueba | Resultado |
|---|---|
| Lógica (`npm run qa`) | **1 462 aprobadas · 0 fallidas** (Node 20 y Node 24) |
| Carga del frontend (`qa/frontend.mjs`) | **10 escenarios · 0 fallidos** |
| Conversaciones (`qa/sesiones.mjs`) | **126 comprobaciones · 0 fallidas** |
| Aceptación en vivo (`qa/aceptacion.mjs`) | **24/24** |
| Barrido por propiedades (`qa/barrido.mjs`) | **200 conversaciones · 1 800 turnos · 0 violaciones** |
| Auditoría independiente | **247 turnos · 304 preguntas · 277 verificadas con matemática propia · 0 fallos** |
| Matriz de rutas alcanzables (intención) | **95 combinaciones · 0 clasifican mal** |
| Secuencia modular en producción, con IA real | 8 temas garantizados + integrales, logaritmos y trigonometría |
| Código entregado == código desplegado | `/api/health` devuelve el mismo hash que el `.zip` |
| Versiones de Node verificadas | **18+**, probado en 20.18.1 y 24.5.0 |
| Protección de `/api/query` | límite general por IP · IA 15/min y 120/h por IP · 500/día global |

La **auditoría independiente** verifica las respuestas con un motor de cálculo distinto del que las
produce: comprobar un resultado con el mismo código que lo generó no comprueba nada.

---

## 6. Desarrollo, por etapas

Veintidós etapas registradas en `Milestone.md` (A–V). En resumen:

| Etapas | Periodo | Contenido |
|---|---|---|
| A–C | 9 jul – 4 ago | Núcleo funcional, capa pedagógica visible, motor determinista |
| D–F | 5–6 ago | Precisión de concepto y cálculo, corrección del propio control de calidad, documentación |
| G–I | 7–8 ago | Prueba por sesiones, comportamiento conversacional, barrido por propiedades |
| J–O | 10–11 ago | Rotación, capturas del cliente, continuidad de clase, navegador, pronunciación |
| P–S | 13–19 ago | Memoria de nivel, coherencia, revisión técnica del cliente, aritmética aplicada |
| T–V | 20 ago | Vocabulario por tema, honestidad ante lo no calculable, estructura modular garantizada |

---

## 7. Fuera de alcance (declarado)

**Garantizado** (lo calcula el sistema, siempre correcto): ecuaciones lineales, derivadas de
polinomios, factorización por diferencia de cuadrados, fracciones y aritmética básica.

**De mejor esfuerzo** (lección generada por la IA, sin garantía de exactitud): cuadráticas y grados
superiores, sistemas, inecuaciones, trigonometría, logaritmos, exponenciales, integrales, límites y
matrices. En estos temas, cuando el resultado no se puede verificar, **la pregunta se deja sin nota**
en lugar de calificar con un valor no comprobado.

**No incluido en las Fases 1 y 2** (sería alcance nuevo):

- Las cuatro operaciones **dentro** de cada tema (regla del producto y del cociente en derivadas;
  resta, multiplicación y división de fracciones). La aritmética sí las tiene las cuatro.
- Un **temario que avance por sí solo entre temas**. Hoy la clase progresa y cambia de registro
  **dentro** de un tema.
- Persistencia en base de datos, autenticación, roles y panel docente — objeto de la especificación
  **PMV 1**, que es un contrato aparte.

---

## 8. Entregables y cómo verificarlo

- **Aplicación:** https://math-ia.onrender.com
- **Repositorio:** https://github.com/KM99999/Virrey-task
- **Código y documentación:** https://github.com/KM99999/Virrey-task/archive/e96a544dd29ef9ea2d9b421c90f33fce2de7b021.zip
- **Documentación incluida:** `README.md`, `ENTREGA.md`, `GUIA_ACEPTACION.md`, `GUIA_PRUEBAS.md`,
  `GUIA_PRUEBAS_SESION.md` y `Milestone.md`.

```bash
npm install                  # requiere Node 18 o superior (probado en 20 y en 24)
npm run qa                   # 1 462 comprobaciones, sin coste de IA
npm run qa:todo              # batería completa
npm start                    # servidor local en http://localhost:3000
```

Para comprobar que lo entregado es lo desplegado, contraste el hash de `/api/health` con el commit
del `.zip`: deben coincidir.
