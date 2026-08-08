# Milestone 1 — Math IA · Etapas de desarrollo hasta la fecha

**Proyecto:** Math IA — prototipo web de tutor de matemáticas (avatar + pizarra + voz).
**En vivo:** https://math-ia.onrender.com · versión desplegada verificable en `/api/health`.
**Repositorio:** https://github.com/KM99999/Virrey-task (rama `main`).
**Periodo:** 9 de julio – 8 de agosto de 2026 · **190 commits**.
**Estado a 8 de agosto de 2026:** commit `7ac9246` desplegado; Etapas 1 y 2 completas y verificadas.

---

## 1. Alcance acordado

Prototipo web funcional en dos etapas:

**Etapa 1 — núcleo funcional**
Página web · avatar visual básico · entrada por texto · entrada por voz (voz a texto) ·
integración por API con una IA generativa · clasificador de intención (resolver / aprender /
explicar / practicar) · **PRE Light** (motor de resolución pedagógica) · historial de sesión ·
manejo básico de errores · despliegue · código fuente y documentación.

**Etapa 2 — capa pedagógica visible**
Avatar 2D con estados · voz TTS en español · **PSE Light** (sincronización voz ↔ pizarra ↔
revelación progresiva) · ramificación ligera (pista y reintento sin revelar la respuesta).

---

## 2. Arquitectura resultante

La decisión de diseño más importante del proyecto **no estaba en el encargo original** y apareció
al chocar con la realidad: el modelo económico se equivoca en aritmética. La solución fue invertir
el flujo — la IA dejó de ser el camino por defecto.

```
Consulta (texto / voz)
        │
        ▼
 Clasificador de intención        (src/classifier.js · local, sin coste)
        │
        ▼
 ¿Es un TEMA NÚCLEO? ── SÍ ──→  MOTOR DETERMINISTA        (leccionBotonLSG, src/lsgPrompt.js)
        │                        ecuaciones lineales · derivadas · factorización ·
        NO                       fracciones · aritmética
        │                        0 coste de IA · matemática GARANTIZADA
        ▼                                │
 IA generativa (Gemini) ─────────────────┤    (src/geminiClient.js)
        │                                │
        ▼                                ▼
 PRE Light — valida, normaliza y CORRIGE la aritmética      (src/preLight.js)
        │
        ▼
 Frontend — PSE Light, avatar, TTS, pizarra, historial      (public/)
```

**Consecuencia práctica:** en los cinco temas núcleo el resultado lo calcula el propio sistema con
aritmética exacta (racionales y BigInt), no la IA. Fuera de ellos, la lección es de mejor esfuerzo.

---

## 3. Etapas de desarrollo

### Etapa A — Núcleo funcional (9–20 de julio)

Pipeline completo consulta → clasificador → IA → LSG → PRE Light → frontend. Salida estructurada
con `responseSchema` y `propertyOrdering`, de modo que el modelo calcula la respuesta **antes** de
redactar la lección. Control de coste: clasificación local, llamada única, *context caching* del
prompt de sistema, límites de tokens por ruta y caché de respuestas.

### Etapa B — Capa pedagógica visible (20–28 de julio)

Avatar 2D con estados, TTS en español con normalización de notación matemática a lenguaje hablado
(`x²` → "equis al cuadrado"), PSE Light sincronizando voz y pizarra paso a paso, barra de pasos,
ramificación ligera con pistas que **estructuralmente** no pueden revelar la respuesta (la función
de pista no recibe el valor), e historial de sesión persistente entre recargas.

### Etapa C — Validación matemática y motor determinista (28 de julio – 4 de agosto)

La etapa que cambió la arquitectura. Se construyó, tema a tema, un motor que **calcula el sistema,
no la IA**:

- Ecuaciones lineales paso a paso, con solución **exacta en fracción** (no decimales truncados).
- Derivadas por la regla de la potencia; factorización por diferencia de cuadrados; fracciones.
- Aritmética básica determinista (suma, resta, multiplicación, división), con **BigInt** para
  productos grandes y práctica del mismo tamaño que el ejemplo.
- `corregirIgualdades`: se verifica y corrige **toda** igualdad escrita o dicha ("200 ÷ 25 = 200" → 8).
- Normalización de caracteres: menos unicode (`−`), coma decimal, punto medio, superíndices.

### Etapa D — Precisión de concepto y de cálculo (5–6 de agosto)

Primera ronda de esta fase. Defectos en los que el sistema **respondía a una pregunta distinta**:

| Defecto | Corrección |
|---|---|
| `deriva 3x⁴ - 2x²` derivaba solo el primer término | Deriva el polinomio completo, con desglose término a término |
| `2(x+3) = 10`, `x/2 = 4`, `0,5x = 4` no las resolvía el motor | Analizador lineal único y exacto; se enseñan repartiendo el paréntesis o quitando el denominador |
| `¿Qué es factorizar?` resolvía en vez de enseñar | El verbo casaba dentro del sustantivo; ahora las claves casan por palabra completa |
| `Resuelve -2x = 8` no se resolvía | La ecuación podía empezar dentro de una palabra; se ancla su inicio |

### Etapa E — Corrección del propio control de calidad (5–6 de agosto)

**El hallazgo más importante del proyecto.** Al revisar por qué los defectos llegaban al cliente
antes que a nosotros, se encontró que **las pruebas estaban mal**:

- **Cinco comprobaciones daban por correcto el comportamiento defectuoso.** Una afirmaba que
  `2(x+1) = 6` "no es lineal" y exigía NO resolverla. Mientras existieran, esos defectos eran
  indetectables: la batería los protegía.
- **`qa/aceptacion.mjs` marcaba en rojo lecciones correctas** (22/24), y con ese ruido un fallo
  real se confunde con los falsos.
- **La verificación era circular:** las pruebas comprobaban el sistema con las funciones del propio
  sistema, así que un error compartido resultaba invisible.

Se corrigieron las pruebas **antes** que el producto, y se añadió una **auditoría independiente**:
368 comprobaciones que verifican con matemática distinta de la que produjo el resultado (ecuaciones
resueltas evaluando la igualdad en dos puntos, factorizaciones expandidas, derivadas recalculadas
término a término).

### Etapa F — Documentación y entrega (6 de agosto)

`ENTREGA.md` declaraba un commit y unas cifras que ya no coincidían con producción, en un documento
que invita al cliente a comprobarlo en `/api/health`. Se actualizó, y el diagrama del `README`
pasó a mostrar el **motor determinista** — hasta entonces la documentación describía un sistema
distinto del entregado. Se generó el `.zip` con `git archive` del commit desplegado.

### Etapa G — Prueba por SESIONES (7 de agosto)

Se identificó por qué las pruebas y la experiencia del cliente se contradecían: **`aceptacion.mjs`
daba 24/24 sobre una versión en la que sí había fallos.** Las pruebas comprobaban **consultas
sueltas**; el cliente **conversa**. Todos los defectos vivían en la secuencia:

- "dame otro ejemplo" solo se desviaba con un tema ya activo;
- el bucle de escenarios aparecía en la 4.ª o 5.ª petición;
- "enséñame a sumar" se desviaba a fracciones según el contexto.

Se creó `qa/sesiones.mjs`: seis conversaciones completas con el mismo estado que el navegador y
usando las **funciones reales del frontend**, más `GUIA_PRUEBAS_SESION.md` para repetirlas a mano.

### Etapa H — Comportamiento conversacional (6–7 de agosto)

| Queja del cliente | Corrección |
|---|---|
| "otro ejemplo" entregaba ejercicios de práctica | `ejemplo` = verlo resuelto · `ejercicio` = resolverlo él |
| "solo tres ejemplos de derivadas, como un bucle" | Tildes en la clave de rotación + dos escenarios nuevos: **7** rotando |
| Respuesta correcta calificada como incorrecta | Se acepta la respuesta escrita en frase ("la respuesta es 4") |
| "resuélvela" cambiaba de ejercicio | Nunca cambia: resuelve el de pantalla o lo dice con claridad |
| "más difícil" daba ejercicios semejantes | Otra **estructura**: paréntesis, x en ambos lados, denominador |
| "no entendí" cambiaba de ejercicio | Re-narra **el mismo** problema, en los cinco temas |
| "no entendí" no distinguía concepto de problema | Concepto → explicación más sencilla; problema → por qué se resuelve así |
| El concepto se repetía palabra por palabra | Varias redacciones por tema; se usa la que no acaba de ver |

### Etapa I — Barrido por propiedades (8 de agosto)

Última etapa, y un cambio de método. Las pruebas anteriores comprobaban **lo que esperábamos**; el
cliente encontraba **lo que no se nos había ocurrido comprobar**. Se creó `qa/barrido.mjs`, que no
afirma "esto debe dar X": genera **140 conversaciones (1 260 turnos)** y exige invariantes que
deben cumplirse en cualquier camino — la respuesta nunca depende de la IA en un tema del alcance,
la lección nunca queda vacía, la práctica calificable siempre es correcta, pedir "otro" no devuelve
lo mismo, "no entendí" no cambia de problema, pedir un ejemplo no da ejercicios.

**En su primera ejecución encontró 170 violaciones y un defecto real dentro del alcance que el
cliente aún no había reportado:** en una sesión de aritmética, cualquier seguimiento salía del
motor determinista hacia la IA. Después encontró un segundo: la red de seguridad no rotaba el
ejemplo, así que "y otro más" repetía la misma lección.

---

## 4. Estado verificado a 8 de agosto de 2026

| Prueba | Resultado |
|---|---|
| Lógica (`npm run qa`) | **915 aprobadas · 0 fallidas** |
| Barrido por propiedades (`qa/barrido.mjs`) | **140 conversaciones · 1 260 turnos · 0 violaciones** |
| Sesiones (`qa/sesiones.mjs`) | **134 comprobaciones · 0 fallidas** |
| Aceptación en vivo (`qa/aceptacion.mjs`) | **24/24** |
| Contrato de Etapas 1 y 2, punto por punto | **12/12 · 129 comprobaciones** |
| Auditoría independiente del motor | **368 comprobaciones** |
| Código entregado == desplegado | `/api/health` coincide con el `.zip` |

---

## 5. Alcance garantizado y fuera de alcance

**Garantizado** (lo calcula el sistema, siempre correcto): ecuaciones lineales — incluidas las de
paréntesis, x en ambos lados, denominador y coeficiente decimal —, derivadas de polinomios,
factorización por diferencia de cuadrados, fracciones y aritmética básica.

**Fuera de alcance** (lección de mejor esfuerzo generada por la IA, sin garantía de exactitud):
cuadráticas y grados superiores, sistemas, inecuaciones, trigonometría, logaritmos, exponenciales,
**integrales**, límites, matrices.

---

## 6. Puntos abiertos

1. **Rotación en ecuaciones lineales:** al repetir muchas veces la misma petición todavía puede
   repetirse una lección dos veces seguidas. La corrección completa pide un cursor de rotación
   propio en vez de deducir la posición del texto ya visto.
2. **Bajar a un problema más fácil** tras varios "no entendí" seguidos: solicitado el 7 de agosto,
   no implementado.
3. **Ruta de IA sin verificar:** `qa/verificar.mjs` (las 4 intenciones con Gemini real) no se ha
   ejecutado, porque consume saldo de la cuenta del cliente.
4. **Despliegue automático:** los despliegues se disparan por *Deploy Hook*; el aviso por *push*
   de GitHub nunca ha llegado a funcionar.

---

## 7. Lecciones del proyecto

1. **Una batería en verde no prueba que el sistema sea correcto** si las pruebas se escribieron
   mirando el código. Cinco comprobaciones certificaban los propios defectos.
2. **Verificar con el mismo motor que produce el resultado no verifica nada.** La auditoría
   independiente encontró en minutos un defecto que había sobrevivido a 841 comprobaciones.
3. **El alumno conversa; las pruebas preguntaban de una en una.** Todos los defectos de esta fase
   vivían en la secuencia, no en la consulta aislada.
4. **Comprobar lo que uno espera solo encuentra lo que uno ya imaginó.** El barrido por
   propiedades, que no afirma resultados concretos, encontró dos defectos reales en su primera
   ejecución — antes que el cliente.
5. **Documentación desactualizada es un defecto**, no una cuestión de forma: `ENTREGA.md` invitaba
   a comprobar un commit que ya no era el desplegado.

---

## 8. Cómo verificarlo

```bash
npm install

QA_SKIP_LIVE=1 npm run qa            # lógica, sin coste ni red
node qa/barrido.mjs                  # 140 conversaciones por propiedades
node qa/sesiones.mjs                 # 6 conversaciones guionizadas
node qa/aceptacion.mjs               # 24 interacciones de la guía de aceptación
node qa/verificar.mjs                # IA real (consume saldo de Gemini)
```

Documentos relacionados: [README.md](README.md) · [ENTREGA.md](ENTREGA.md) ·
[GUIA_ACEPTACION.md](GUIA_ACEPTACION.md) · [GUIA_PRUEBAS_SESION.md](GUIA_PRUEBAS_SESION.md) ·
[GUIA_PRUEBAS.md](GUIA_PRUEBAS.md)
