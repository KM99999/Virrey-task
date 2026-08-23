# Milestone — Math IA · Etapas de desarrollo

**Proyecto:** Math IA — prototipo web de tutor de matemáticas (avatar + pizarra + voz).
**En vivo:** https://math-ia.onrender.com · versión desplegada verificable en `/api/health`.
**Repositorio:** https://github.com/KM99999/Virrey-task (rama `main`).
**Periodo:** 9 de julio – 20 de agosto de 2026 · **218 commits**.
**Estado a 20 de agosto de 2026:** commit `d40eee3` desplegado; Etapas 1 y 2 completas y verificadas.

> Este documento es el registro COMPLETO y vigente del desarrollo. `Milestone1.md` es una
> instantánea anterior (hasta el 11 de agosto) que se conserva por trazabilidad.

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

### Etapa J — Cursor de rotación y la frase repetida (10 de agosto)

El barrido encadenaba frases **distintas**; el cliente repite **la misma** muchas veces seguidas. Esa
sola diferencia escondía una clase entera de defectos. Añadido ese patrón al barrido (6 frases × 10
aperturas) y una invariante nueva —al pedir "otro", dos lecciones seguidas no pueden compartir el
ejemplo ni el ejercicio—, el barrido pasó de 200 a 1 800 turnos y sacó cuatro defectos:

1. **La rotación adivinaba su posición.** Deducía por dónde iba **leyendo el texto ya mostrado**; en
   cuanto esa deducción fallaba, volvía al principio y repetía la lección. Sustituida por un **cursor
   explícito** por tema y nivel que viaja con la conversación (el navegador lo guarda, el servidor lo
   avanza y lo devuelve); la lectura del texto queda solo como respaldo. Repitiendo la misma frase
   ocho veces: derivadas 2 → **8** lecciones distintas, factorización 2 → **8**, lineales **8**.
2. **En una sesión de factorización, "no entendí" derivaba el ejercicio** — cambiaba de operación,
   calculaba lo que nadie pidió y lo narraba como una resta, justo donde el alumno acababa de decir
   que no entendía. El desglose paso a paso no sabía factorizar, así que ganaba la lectura siguiente.
   Ahora sabe factorizar (con comprobación multiplicando de vuelta) y la lectura del tema es
   **exclusiva**: una lectura que falla deja re-enseñar el tema, nunca cambiar de operación.
3. Tras un desglose, el navegador guardaba `Resultado: 41` como "el ejercicio en pantalla", y el
   siguiente "resuélvela" desglosaba un resultado.
4. Las lecciones de la vida real no rotaban con cursor y entregaban como práctica una expresión que
   también está en la lista numérica, así que la lección siguiente abría con lo recién practicado.

Y otra corrección **al propio control de calidad**: dos comprobaciones de aceptación daban por
defectuoso un producto correcto (el verificador no sabía leer paréntesis ni desarrollar un factor
común), y una de lógica medía la posición de la lista en vez de la dificultad. Los verificadores
ampliados se probaron contra respuestas erróneas a propósito: siguen rechazándolas.

### Etapa K — Las cuatro capturas del cliente (10 de agosto)

Cuatro defectos reportados **con capturas de pantalla**, reproducidos uno a uno contra el servidor:

1. **Enunciado incoherente** — la lección de la vida real da la derivada YA calculada (2q) y pide
   EVALUARLA, pero el enunciado se leía como si pidiera derivar otra vez; y al fallar, la pista
   explicaba *la regla de la potencia* cuando lo que había que hacer era **sustituir** un número.
   Al reescribirlo aparecieron dos trampas más, ambas detectadas por las propias pruebas:
   `sustituye q = 5` se lee como igualdad resuelta (el alumno puede tomar 5 por respuesta, siendo 10),
   y `s'(t) = 2t` se parsea como la ecuación `t = 2t`, cuya solución sería 0 — al pedir "explícame los
   pasos" sobre esa línea se narraba un despeje ajeno al ejercicio.
2. **"No entendí" cambiaba el caso real** — la pizarra iba de una fábrica y la re-explicación pasaba a
   un coche. Ahora "no entendí"/"explícalo mejor"/"¿por qué?" mantiene el caso y añade una explicación
   NUEVA (mantenerlo sin cambiar de palabras sería la otra queja: "lo mismo, como un bucle").
3. **Dos ejercicios, uno calificado** — el segundo se anunciaba como "(extra)" y nunca se validaba.
   Ahora se califican **los dos**, en los cinco temas, cada respuesta comprobada.
4. **La voz cambiaba de mujer a varón** — no se elegía por género y `onvoiceschanged` re-elegía voz a
   mitad de sesión. Ahora se prefiere una voz masculina y queda **fijada** en la primera locución.

Dos de estos defectos estaban **certificados como correctos** por las propias pruebas: el QA exigía
literalmente UNA sola pregunta en la práctica, y la invariante de "no entendí" del barrido no miraba
las lecciones de la vida real (su línea de ejercicio lleva ":" y quedaba fuera de la comparación).

### Etapa L — Comportamiento de clase: continuidad, lenguaje y escalera de "no entendí" (10 de agosto)

Tres quejas más, ninguna de matemáticas. Todas de **cómo se comporta el tutor**:

1. **"Apariencia de robot"** — al pedir otro ejercicio cambiaban los números y todo lo demás se
   repetía palabra por palabra (la introducción de la práctica y el recordatorio del método; el
   cliente los señaló con un recuadro). Ahora rotan las introducciones, los arranques, el recordatorio
   de cada tema y las frases de acierto. El QA **mide** la repetición: menos de la mitad de lo que dice
   el tutor puede ser literal de la tanda anterior.
2. **"Enseña un ejercicio y culmina la clase"** — se acababa de verdad: resuelto el ejercicio, el tutor
   callaba hasta que el alumno escribiera. Ahora enlaza el tramo siguiente y la clase **progresa**: dos
   aciertos seguidos suben el nivel, un fallo trae otro ejemplo resuelto. Acotado por cuatro vías: cada
   tramo termina en una pregunta que solo el alumno puede contestar, un tope de 6 tramos, «Detener», y
   cualquier consulta del alumno cancela el tramo pendiente.
3. **Insistir en "no entendí" devolvía la MISMA respuesta** — medido: 4 «no entendí» seguidos daban 1
   sola respuesta distinta en 4 de los 5 temas. Defecto **introducido por la corrección anterior**: al
   arreglar que "no entendí" cambiaba el ejercicio, pasó a mantenerlo demasiado bien —correcto la
   primera vez, literal desde la segunda—, y la comprobación de entonces probaba una re-explicación,
   no la insistencia. Ahora hay una **escalera de simplificación**: otra forma de verlo → caso mínimo
   con números pequeños e imagen cotidiana → la regla desnuda **y ejercicio del nivel fácil**.

Ese último escalón cierra la petición del 7 de agosto (*bajar a un problema más fácil tras varios "no
entendí"*), que figuraba como no construida en las etapas anteriores de este documento.

### Etapa M — Lo que el alumno teclea de verdad (10 de agosto)

Revisión a fondo con las cinco baterías en verde, buscando por donde ninguna miraba: 247 turnos con
toda respuesta calificable verificada con matemática escrita aparte, conversaciones de 25 turnos,
respuestas erróneas a propósito, entradas adversas (cursor manipulado, unicode, coma decimal) y
alternancia de temas. Cero problemas ahí. El defecto salió al probar lo que un alumno escribe entre
ejercicio y ejercicio:

- Con un tema del alcance ACTIVO, escribir **"ok", "vale", "listo", "perfecto", "hola" o "gracias"**
  salía del motor determinista y acababa en la IA. Rompía la garantía, costaba una llamada y lo que
  volvía era visiblemente roto: la pizarra mostraba **la propia frase anterior del alumno**. Causa: esas
  palabras estaban en la lista de "saludo", cuya implementación devolvía `null` — es decir, *que lo
  resuelva la IA*. Correcto no dar lección; incorrecto mandarlo al modelo. Ahora se distinguen tres
  cosas: **acuse de recibo** (nota breve), **pedir seguir** ("siguiente", "adelante" → lección) y
  **cortesía** (nota breve).
- Destapado por el anterior: tras unos ejemplos de la vida real y un par de "ok", un "no entendí"
  volvía al **primer ejercicio de la sesión**, porque al re-explicar se caía al *tema* como último
  recurso. Ese recurso solo se usa ya cuando no sabemos qué hay en pantalla.

### Etapa N — El navegador, y lo que se ve al empezar (10 de agosto)

Dos frentes que ninguna prueba cubría.

**El navegador.** Todas las pruebas hablaban con el servidor; ninguna cargaba `public/app.js`. Si el
frontend falla al cargarse la página queda muerta y las cinco baterías siguen en verde. Se creó
`qa/frontend.mjs` (carga en un DOM simulado: primera visita, recarga con sesión guardada y seis formas
de sesión corrupta). Con él aparecieron tres defectos:

1. **Recargar la página (F5) reiniciaba la rotación:** el cursor no se guardaba con el resto de la
   sesión, así que al refrescar volvía el PRIMER ejemplo del tema.
2. En la práctica, **acertar el primer ejercicio tapaba fallar el segundo** (la clase subía de nivel).
3. El **tope de claves del cursor** estaba a siete de romperse (40 aceptadas, 33 generadas); pasarse no
   da error, descarta claves en silencio y esa rotación deja de avanzar. Subido a 80, con comprobación.

**Lo que se ve al empezar.** El cliente insistió: "pido ejemplos distintos y se repite el mismo".
Reproducido su historial exacto, el servidor rotaba bien —9 lecciones distintas de 10— pero **la
lección abría siempre igual**: misma frase hablada y misma primera línea de pizarra (el concepto), con
la expresión nueva varios pasos más abajo. Su captura está parada en el **paso 2 de 11**, y sus
consultas van a 2-4 segundos una de otra: nunca llegaba a ver el ejemplo, solo la apertura. Ahora, en
un seguimiento, lo primero que se dice y se escribe **identifica ese ejemplo** ("Vamos con otra
función: 2x³", "Veámoslo con una fábrica").

Mi comprobación decía "8 de 8 distintas" y era cierta: comparaba la lección ENTERA. El alumno ve el
arranque. Hay ahora una comprobación que mide el ARRANQUE en 8 combinaciones de tema y petición.

### Etapa O — Cómo suena en español (11 de agosto)

Dos quejas del cliente, con captura, y la voz masculina ya funcionando en su equipo (Microsoft Raul).

- **"A todos los ejercicios pronuncia el mismo encabezado"**: la tanda de práctica abría con dos
  párrafos —presentación y recordatorio del método— y el ejercicio venía después. Aunque esos párrafos
  rotaban, lo primero que se oía seguía siendo un preámbulo. Ahora **abre con su ejercicio**, y el
  recordatorio del método aparece **una vez por tema**, no en cada tanda.
- **"En lugar de decir 'ene', dice 'yeni'"**: el diccionario del motor de voz no se puede corregir
  desde la aplicación, pero sí lo que se le da a leer. La letra suelta venía de explicar la regla como
  "la derivada de x elevado a n es n por x elevado a n menos 1"; ahora se explica con un exponente
  **concreto** ("la derivada de x³ es 3x²"), que además se entiende mejor. La notación general se
  mantiene en la pizarra, que no se lee en voz alta.

Revisando **todas** las frases habladas aparecieron cuatro defectos más de pronunciación, ninguno
reportado, y dos de ellos son de MATEMÁTICAS, no de estilo:

| Escrito | Se oía | Ahora |
|---|---|---|
| `(x - 3)(x + 3)` | "equis menos 3 equis más 3" — **sin el "por"** | "equis menos 3 **por** equis más 3" |
| `2(x + 3)` | "2 equis más 3" — se escribiría 2x + 3 | "2 **por,** equis más 3," |
| `C'(q)` | "ce**'** cu" (la comilla, cruda) | "ce **prima de** cu" |
| `s(t)` | "ese te" | "ese **de** te" |

Comprobación permanente nueva: se recogen **todas** las frases habladas de muchas lecciones y se exige
que no quede ningún símbolo, superíndice, comilla angular ni letra suelta sin nombre, más nueve
expresiones concretas verificadas una a una.

### Etapa P — El nivel se recuerda, y practicar deja de ser enseñar (13–14 de agosto)

Dos quejas que apuntaban a lo mismo: el sistema no conservaba el estado de la clase.

- **"Me enseñaba monomios, luego polinomios, y luego volvió a monomios."** El nivel se deducía SOLO
  del mensaje actual, así que *"dame ejercicios más complejos"* duraba **un turno**: el siguiente
  "otro ejemplo" volvía a nivel normal. En derivadas se nota de inmediato, porque los polinomios
  están en el nivel difícil y los monomios en el normal. Además dejaba sin efecto la progresión de la
  clase encadenada: subía tras dos aciertos y el tramo siguiente lo deshacía. El nivel pasa a
  guardarse en el cursor: sube cuando se pide, se mantiene, baja solo si se pide, y reabrir el tema
  vuelve a normal.
- **"Me dice a practicar, y me sigue enseñando."** Era literal: tras anunciar *"¡A practicar!"*, el
  tutor recitaba la regla y **resolvía un ejemplo** justo antes de preguntar lo mismo. La práctica es
  ahora solo ejercicios; el método aparece cuando hace falta —pista al fallar, lección al decir "no
  entendí", paso a paso al pedir "resuélvelo"—. Era la MISMA queja de julio ("le pido ejercicios y me
  sigue enseñando"): entonces se corrigió el encaminamiento y el recordatorio se quedó dentro.

### Etapa Q — Coherencia entre lo que enseña y lo que deja (14 de agosto)

- **"Te enseña derivadas de 3 monomios, pero te deja de dos."** La práctica se tomaba a media vuelta
  de la lista, sin mirar la estructura del ejemplo. Ahora se elige con la **misma forma**: mismo
  número de términos en derivadas; mismo tipo en ecuaciones (paréntesis, denominador, x en los dos
  lados, términos que agrupar). Apareció además un choque entre dos reglas: `2(x + 4) = 3x - 1` se
  trataba solo como "de dos lados" y recibía una práctica sin paréntesis, más fácil que el ejemplo.
- **"Se duplica el contenido."** Regresión propia: al anunciar el ejemplo al abrir la lección, la
  expresión se escribía dos veces en la pizarra.
- **"Las indicaciones no son claras."** Ante una **integral**, la pista era la de aritmética
  ("recuerda el orden, primero × y ÷"), porque en la pizarra había un "+". En los temas que el motor
  no garantiza ya no se inventa un método: se remite al ejemplo resuelto.

### Etapa R — Revisión técnica del cliente (18 de agosto)

El cliente encargó una revisión técnica con cinco exigencias, todas atendidas con evidencia:

| Punto | Resultado |
|---|---|
| `qa/frontend.mjs` fallaba en Node 24 | Reproducido en **Node 24.5.0 real**: `TypeError: Cannot set property navigator of #<Object> which has only a getter`. Desde Node 21 `navigator` es de solo lectura; los globales se instalan ahora con `Object.defineProperty` |
| Precisar la versión de Node | `jsdom` figuraba como dependencia de desarrollo y **no se importaba en ningún fichero**: solo exigía un Node más alto del necesario. Eliminado. Verificado en **20.18.1 y 24.5.0** |
| Demostrar Gemini real | `modo_ia: gemini`, `fuente_ia: gemini`, 5 401 tokens (4 086 cacheados) sobre una consulta fuera del motor determinista |
| Confirmar código entregado = desplegado | Mismo hash en el paquete y en `/api/health` |
| Proteger `/api/query` | Tres capas: tope general por IP, tope de IA por IP (15/min, 120/h) y **tope global diario de IA** (500). Solo se descuenta si la lección vino REALMENTE del modelo, no de la caché ni del mock |

**Dos ajustes propios corregidos antes de entregar:** con topes de 300/min y de 1 200/min, encadenar
las cinco baterías desde la misma IP hacía saltar el limitador y **las pruebas daban fallos falsos**.
El tope general no es lo que protege la cuota —eso lo hace el de IA— y debe ser holgado.

En la misma ronda: la explicación hablada dejó de duplicarse en la pizarra, el mensaje de acierto
dejó de salir a la vez en dos sitios, y la clase encadenada pasó de 6 a 12 tramos **variando de
registro** (cada tercer tramo, ejemplo aplicado) en vez de encadenar ejercicios numéricos.

### Etapa S — La aritmética, como se enseña de verdad (19 de agosto)

Tres observaciones sobre la resta, las tres ciertas:

1. **El nivel retrocedía.** La rama de "ejemplo de la vida real" en aritmética no recibía el nivel:
   de ejercicios de tres cifras se volvía a dos. Y "no entendí" tenía el mismo agujero.
2. **Faltaba la aplicación.** La aritmética era el **único** tema sin lección aplicada. Ahora hay
   **problemas de enunciado** en las cuatro operaciones, con números del nivel activo: se resuelve
   uno mostrando cómo se traduce el enunciado a la operación y se deja otro, calificable.
3. **Faltaban los nombres de las partes** — minuendo, sustraendo y diferencia; sumandos y suma;
   factores y producto; dividendo, divisor y cociente —, ahora dichos sobre el ejemplo a la vista.

Al añadirlo, el barrido destapó que "no entendí" sobre un problema de enunciado devolvía una
operación suelta. La causa de fondo ya había mordido antes: **saber si el alumno está en un caso real
se deducía leyendo el texto de la lección anterior**, y basta un "ok" o un "hola" en medio para que
ese texto ya no lo diga. Ese modo se guarda ahora de forma explícita, como el nivel.

### Etapa T — Escuchar la pregunta, no la palabra (20 de agosto)

Tres capturas más, y los tres defectos con la misma raíz: el sistema decidía por **la palabra del
tema** que aparecía en la consulta, sin mirar **qué se estaba preguntando**.

1. **"¿Cuáles son las partes de una derivada?" resolvía un ejercicio.** La consulta lleva la palabra
   "derivada", así que la rama de RESOLVER se la llevaba. Pasaba en los ocho temas. La aritmética sí
   tenía los nombres desde la Etapa S, pero solo **dentro** de la lección de concepto: quien
   preguntaba por ellos directamente no los recibía. Ahora cada tema tiene su **lección de partes**,
   sobre un ejemplo a la vista y con pregunta calificable: derivada (función, variable, coeficiente,
   exponente, `f'(x)`), ecuación (miembros, incógnita, coeficiente, término independiente),
   factorización (expresión, raíces, factores, producto), fracción (numerador, denominador) y las
   cuatro operaciones.
2. **Un "sí" a "¿entendiste?" cambiaba de tema.** En clase de factorización, el alumno contestó "sí"
   y el sistema se puso a enseñar derivadas. "Sí" y "no" no estaban en ninguna lista —ni saludo, ni
   muletilla, ni re-explicación—, así que salían del motor determinista y la IA, viendo solo la
   palabra "sí", elegía tema por su cuenta. Es la respuesta a una pregunta que hace **el propio
   tutor**: no puede cambiar de tema. "Sí" continúa la clase; "no" re-explica lo mismo más sencillo.
3. **"Resuélvelo" narraba una diferencia de cuadrados sobre el resultado de una derivada.** El
   desglose recibía el ejercicio sin saber qué hacer con él —"Ejercicio 1: 4x³ - 3x² + 2x", tal cual
   sale de la pizarra de práctica— y lo decidía por el **aspecto** de la expresión. Ahora el tema
   activo viaja con el desglose y manda; y el desglose ya sabe **derivar término a término**, que
   antes no sabía: escribía el resultado sin procedimiento.

De paso: un "ok" en mitad de la clase respondía "¡Hola de nuevo!", como si el tutor se hubiera
reiniciado; una respuesta con tilde ("incógnita") se calificaba mal **por la tilde**; y una pregunta
de nombres recibía la pista de la regla de la potencia en vez de remitir al rótulo de la pizarra.

### Etapa U — Lo que no se sabe hacer, no se finge (20 de agosto)

El cliente preguntó "¿cómo se multiplica dos funciones en las derivadas?" y recibió la lección de la
regla de la potencia. La consulta lleva la palabra "derivada", así que la rama determinista la
capturaba **aunque el motor no calcule el producto de dos funciones**, y respondía con la operación
que sí sabe. El mismo agujero estaba en fracciones y allí era peor: preguntar cómo se multiplican dos
fracciones enseñaba a **sumarlas**. Eso no es una laguna; es un método equivocado con aspecto de
respuesta. Ahora ambas salen del motor determinista y las explica la IA (Nivel 3), igual que ya hacían
el seno, el logaritmo y la raíz.

La **suma y la resta de derivadas** sí estaban cubiertas desde el principio —derivar un polinomio ES
derivarlo término a término—, pero no se decía. Al preguntar por ellas se enseña ahora con un
polinomio y se nombra la regla. Y el orden que pidió el cliente —"primero qué es, luego las partes,
luego las operaciones"— se cumple solo: la clase encadenada enlaza la lección de vocabulario en el
primer tramo, en los ocho temas.

**Lo que apareció al comprobarlo en producción.** Abrir la ruta de IA hizo alcanzables tres defectos
que estaban esperando ahí, y que ninguna consulta de las que se prueban habitualmente escribe:

1. **Un producto se leía como una suma.** `computeDerivative` admite el `*` como separador del
   coeficiente (`3*x^2` es 3·x²), así que leía `x³ * x⁴` como dos términos sumados y devolvía
   **4x³ + 3x²** cuando la derivada es **7x⁶**. No es una laguna: es una respuesta rotundamente
   equivocada salida de la parte **garantizada**, y esa misma función es la que **califica** al alumno.
2. **La nota salía de la función del ejemplo.** Rechazado ya el cálculo del producto, el sistema
   buscaba una función derivable en la pizarra y encontraba la del ejemplo: calificaba
   "¿la derivada de h(x) = x³·x⁴?" con **3x²**. Un alumno que respondiera bien recibía un
   "incorrecto" — la peor forma de fallar, y la primera queja histórica del cliente.
3. **Notación prima sin la palabra "derivada".** La regla dura que evita calificar lo que no se ha
   podido calcular buscaba la palabra en la pregunta; con `g'(x)` no la encontraba y la pregunta
   acababa calificada por los pasos aritméticos, que sacan un número suelto de la frase.

Los tres tienen la misma raíz: **cuando no podía calcular lo que se preguntaba, el sistema seguía
buscando algo que calcular en vez de admitir que no lo sabía.**

De paso, dos más: una pregunta de **sustitución** ("la derivada es C'(q) = 2q, ¿cuánto vale con
q = 5?") se cambiaba por una ecuación lineal ajena, porque el "q = 5" se leía como la solución
delatada y no como el dato que se da; y `sin(x)` se leía en voz alta "si **ene** de equis", porque la
regla que convierte `f(x)` en "efe de equis" se comía la última letra del nombre de la función.

---

## 4. Estado verificado a 20 de agosto de 2026

| Prueba | Resultado |
|---|---|
| Lógica (`npm run qa`) | **1 413 aprobadas · 0 fallidas** (Node 20 y Node 24) |
| Carga del frontend (`node qa/frontend.mjs`) | **10 escenarios · 0 fallidos** (Node 20 y Node 24) |
| Auditoría independiente | **247 turnos · 304 preguntas · 277 verificadas aparte · 0 fallos** |
| Barrido por propiedades (`qa/barrido.mjs`) | **200 conversaciones · 1 800 turnos · 0 violaciones** |
| Sesiones (`qa/sesiones.mjs`) | **126 comprobaciones · 0 fallidas** |
| Aceptación en vivo (`qa/aceptacion.mjs`) | **24/24** |
| Contrato de Etapas 1 y 2, punto por punto | **12/12 · 129 comprobaciones** |
| Auditoría independiente del motor | **368 comprobaciones** |
| Código entregado == desplegado | `/api/health` devuelve el MISMO hash que el `.zip` |
| Versiones de Node verificadas | **18+**, probado en **20.18.1** y **24.5.0** |
| Protección de `/api/query` | tope general por IP · IA 15/min y 120/h por IP · **500/día global** |
| Quejas de las capturas, reproducidas por HTTP | **13 comprobaciones · 0 fallidas** |
| Clase encadenada completa, por HTTP | **12 tramos × 5 temas · deterministas de principio a fin** |

---

## 5. Alcance garantizado y fuera de alcance

Cada tema garantizado se enseña en tres registros: **concepto** (qué es y cómo se llama cada parte),
**ejercicio** resuelto paso a paso con práctica calificable, y **aplicación** a un caso real o
problema de enunciado.

**Garantizado** (lo calcula el sistema, siempre correcto): ecuaciones lineales — incluidas las de
paréntesis, x en ambos lados, denominador y coeficiente decimal —, derivadas de polinomios,
factorización por diferencia de cuadrados, fracciones y aritmética básica.

**Fuera de alcance** (lección de mejor esfuerzo generada por la IA, sin garantía de exactitud):
cuadráticas y grados superiores, sistemas, inecuaciones, trigonometría, logaritmos, exponenciales,
**integrales**, límites, matrices.

---

## 6. Puntos abiertos

1. **Ruta de IA sin verificar:** `qa/verificar.mjs` (las 4 intenciones con Gemini real) no se ha
   ejecutado, porque consume saldo de la cuenta del cliente.
2. **Despliegue automático:** los despliegues se disparan por *Deploy Hook*; el aviso por *push*
   de GitHub nunca ha llegado a funcionar.
3. **La voz depende del equipo del alumno:** el tutor elige una voz masculina en español entre las que
   el navegador ofrece. En un equipo sin ninguna instalada se usa la disponible con el tono bajado. Lo
   que sí queda garantizado en cualquier equipo es que **no cambia de voz durante la sesión**.
4. **Sin verificación por navegador:** todas las pruebas llegan al sistema por su interfaz de datos.
   La sincronización de voz y pizarra y el comportamiento en móvil no están cubiertos por ellas.

5. **Las cuatro operaciones en cada tema:** el cliente pide que todo tema enseñe sumar, restar,
   multiplicar y dividir. Hoy: la **aritmética** ya las tiene las cuatro (son sus cuatro temas); en
   **derivadas** están la suma y la resta (derivar un polinomio término a término), y faltan el
   producto, el cociente y la cadena; en **fracciones** está la suma, y faltan resta, multiplicación y
   división; en **factorización** y **ecuaciones lineales** la petición habría que concretarla, porque
   "las operaciones de la factorización" no designa un contenido definido. Lo que falta es CONTENIDO
   NUEVO, no un defecto: mientras no exista, esas consultas salen del motor determinista y las explica
   la IA, en vez de contestarse con otra operación (Etapa U). Sería una **etapa nueva**, con su
   alcance y su presupuesto.
6. **Temario que avance ENTRE temas:** el cliente lo ha pedido tres veces. Hoy la clase progresa y
   cambia de registro DENTRO de un tema (ejercicio → subir nivel → ejemplo aplicado), pero no decide
   por su cuenta dar por terminada la resta y pasar a otra materia. Un temario con secuencia entre
   temas, criterios de avance y cierre es un producto distinto del prototipo acordado en las Etapas
   1 y 2: sería una **etapa nueva**, con su alcance y su presupuesto. Comunicado así al cliente.

*Puntos cerrados que figuraron aquí:* la rotación en ecuaciones lineales (8 de agosto → corregida el
10 con el cursor explícito, Etapa J); bajar a un problema más fácil tras varios "no entendí" (7 de
agosto → construida el 10 como tercer escalón de la escalera, Etapa L); y la falta de aplicación en
aritmética (→ construida el 19 de agosto con los problemas de enunciado, Etapa S); y **las partes de
cada tema**, que solo tenía la aritmética y solo dentro del concepto (20 de agosto → lección propia de
vocabulario en los ocho temas, Etapa T); y **la suma y la resta de derivadas**, que estaban cubiertas
desde siempre sin decirse (20 de agosto → se enseñan con un polinomio y se nombra la regla, Etapa U).

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
6. **Medir lo que uno considera importante no es medir lo que el alumno ve.** La comprobación decía
   "8 de 8 lecciones distintas" y era cierta: comparaba la lección ENTERA. Pero todas ABRÍAN igual, y
   el cliente —que encadenaba peticiones cada dos segundos— solo llegaba a ver el arranque. Tenía
   razón en lo que veía. Hoy se mide el arranque: primera frase hablada y primera línea de pizarra.
7. **La mitad de los defectos de las últimas rondas estaban en la corrección anterior.** Mantener el
   caso al re-explicar (para no cambiar de ejercicio) lo mantuvo *demasiado* y repetía el texto
   palabra por palabra; anunciar el ejemplo al abrir (para que no abrieran todas igual) duplicó la
   línea en la pizarra; el propio limitador de solicitudes bloqueaba las baterías de prueba. Toda
   corrección necesita su comprobación **y** una revisión de lo que rompe.
8. **Deducir el estado leyendo el texto anterior es frágil por construcción.** Cayó tres veces: la
   rotación (se perdía y repetía la lección), el nivel (duraba un turno) y el modo aplicado (un "ok"
   entre medias lo borraba). Lo que es estado debe guardarse como estado, no inferirse.
9. **Escuchar la pregunta, no la palabra.** Tres defectos seguidos salieron de encaminar la consulta
   por el TEMA que nombraba en vez de por lo que PEDÍA: "¿cuáles son las partes de una derivada?"
   resolvía un ejercicio, y "sí" —contestando a "¿entendiste?"— cambiaba de tema porque no encajaba
   en ninguna lista y salía del motor determinista. Lo que el sistema no clasifica, lo clasifica la
   IA por su cuenta, y ahí es donde se pierde el hilo de la clase.
10. **Comprobar lo que de verdad se está sirviendo, no lo que uno cree que sirve.** Los tres defectos
   más graves de todo el proyecto —un producto leído como una suma, una nota sacada de la función
   equivocada, una pregunta calificada con un número inventado— no los encontró ninguna de las 1 413
   comprobaciones. Aparecieron al volver a consultar el sistema EN PRODUCCIÓN después de desplegar, y
   cada uno salió de un borrador distinto de la IA: ninguna consulta escrita por una persona escribe
   un producto de potencias. Desplegar no es terminar; hay que ir a mirar.
11. **Distinguir el defecto del alcance, y decirlo a tiempo.** Varias peticiones —temario entre temas,
   conversación libre— no eran fallos sino producto nuevo. Tratarlas como defectos habría alargado
   el proyecto sin fin; nombrarlas como etapa nueva permite decidir con criterio.

---

## 8. Cómo verificarlo

```bash
npm install                          # requiere Node 18 o superior (probado en 20 y en 24)

QA_SKIP_LIVE=1 npm run qa            # lógica, sin coste ni red
node qa/frontend.mjs                 # ¿arranca la página? (8 escenarios + orden de sesión)
node qa/barrido.mjs                  # 200 conversaciones por propiedades (1 800 turnos)
node qa/sesiones.mjs                 # conversaciones guionizadas de varios turnos
node qa/aceptacion.mjs               # 24 interacciones de la guía de aceptación
node qa/verificar.mjs                # IA real (consume saldo de Gemini)
```

Documento anterior (instantánea hasta el 11 de agosto): [Milestone1.md](Milestone1.md).

Documentos relacionados: [README.md](README.md) · [ENTREGA.md](ENTREGA.md) ·
[GUIA_ACEPTACION.md](GUIA_ACEPTACION.md) · [GUIA_PRUEBAS_SESION.md](GUIA_PRUEBAS_SESION.md) ·
[GUIA_PRUEBAS.md](GUIA_PRUEBAS.md)
