# Guía de prueba por SESIONES — probar el sistema como lo usa un alumno

Esta guía complementa a [GUIA_ACEPTACION.md](GUIA_ACEPTACION.md). La diferencia es importante.

## Por qué hacía falta

La prueba de aceptación comprueba **consultas sueltas**: se escribe una frase, se comprueba el
resultado y se empieza de cero. Un alumno real no hace eso: **conversa**. Escribe una frase, ve la
respuesta, y sigue —"otro ejemplo", "más difícil", "no entendí"— apoyándose en lo anterior.

Esa diferencia no es un detalle: **la prueba de aceptación llegó a dar 24/24 sobre una versión en
la que sí había fallos reales.** Todos aquellos fallos vivían en la SECUENCIA, no en la consulta
aislada:

- "dame otro ejemplo" solo se desviaba **cuando ya había un tema activo**;
- el bucle de escenarios de la vida real solo aparecía **en la 4.ª o 5.ª petición seguida**;
- "enséñame a sumar…" se desviaba a fracciones **según el contexto de la conversación**.

Con una consulta suelta, ninguno de los tres se ve. Por eso se añade esta guía.

## Cómo ejecutarla automáticamente

```bash
node qa/sesiones.mjs                                  # contra el servicio publicado
MATHIA_URL=http://localhost:3000 node qa/sesiones.mjs # contra un servidor local
```

Reproduce seis conversaciones completas manteniendo el **mismo estado que el navegador** (tema
activo, historial, memoria de la lección anterior y ejercicio en pantalla), y usa las **funciones
reales del frontend** para decidir cada seguimiento — no una copia. Sale con código 1 si algo falla.

## Qué comprueba en CADA turno

| # | Comprobación | Por qué |
|---|---|---|
| 1 | La respuesta es **determinista** (`fuente = local`) | En los cinco temas del alcance el cálculo no debe depender de la IA |
| 2 | El **modo** es el correcto: ejemplo aplicado · ejemplo resuelto · práctica | Pedir un *ejemplo* no debe devolver *ejercicios* |
| 3 | **No se desvía de tema** | Pedir sumar no debe acabar en fracciones |
| 4 | La **práctica está bien calificada** | Se recalcula con matemática INDEPENDIENTE del producto |
| 5 | **No repite** una lección ya mostrada | "otro ejemplo" debe dar otro de verdad |

La comprobación 4 no usa las funciones del sistema: las ecuaciones se resuelven evaluando la
igualdad en dos puntos, las derivadas se recalculan término a término y las factorizaciones se
expanden y se comparan. Así el sistema no puede darse la razón a sí mismo.

## Las seis sesiones (para probarlas también a mano)

Escriba los turnos **en orden**, sin recargar la página entre uno y otro.

### 1. La sesión del cliente (1 ago 2026), literal
1. `Enséñame derivadas`
2. `dame un ejemplo matemático de derivadas`
3. `dame un ejemplo de derivadas diferente al de la velocidad` → un caso **que no sea de velocidad**
4. `dame un ejemplo matemático de derivadas más complejos` → deriva el polinomio **completo**
5. `enséñame a sumar distintas cantidades con diferentes sumandos` → **suma de números**, no fracciones

### 2. Derivadas: insistir en otro ejemplo (el "bucle")
1. `Enséñame las derivadas`
2. a 6. `dame un ejemplo de la vida real` · `dame otro ejemplo de la vida real` · `otro de la vida real` · `dame otro ejemplo de la vida real` · `y otro más de la vida real`
→ **cada uno debe ser un escenario distinto** (hay siete: coche, planta, tanque, rampa, cuadrado, tienda, fábrica).

### 3. Ejemplo ≠ ejercicio
1. `Enséñame las derivadas`
2. `dame otro ejemplo` → ejemplo **resuelto por el tutor**
3. `dame otro ejemplo diferente` → otro ejemplo **resuelto**
4. `dame otro ejercicio` → ejercicios **para resolver usted**
5. `quiero practicar` → práctica

### 4. Ecuaciones lineales: deriva natural
1. `Explícame las ecuaciones lineales`
2. `dame otro ejemplo`
3. `resuélvela` → resuelve **la que está en pantalla**, no otra
4. `proponme un problema más difícil`
5. `ahora uno más fácil`
6. `no entendí, explícalo mejor`

### 5. Fracciones y cambio de tema
1. `Enséñame las fracciones`
2. `dame otro ejemplo`
3. `dame un ejemplo de la vida real`
4. `Enséñame a restar` → cambia de tema de verdad, **sin quedarse en fracciones**
5. `dame otro ejemplo`

### 6. Factorización
1. `Explícame la factorización`
2. `dame otro ejemplo`
3. `proponme uno más difícil`
4. `no entendí`

## Antes de probar

1. **Ctrl+F5.** Una pestaña abierta desde antes sigue ejecutando la página anterior.
2. Compruebe la versión en `/api/health` y anótela junto al resultado.
3. La primera consulta tras un rato de inactividad puede tardar **~50 s** (plan gratuito).

## Si algo falla

Anote **la frase exacta** que escribió, **en qué turno** de la sesión, y qué esperaba ver. Con eso
el fallo se reproduce, se corrige y se añade como **prueba automática permanente**, de modo que esa
misma secuencia quede vigilada para siempre.

## Resultado de la última ejecución

`node qa/sesiones.mjs` contra el servicio publicado: **98 comprobaciones · 0 fallidas**, con las
seis sesiones resueltas de forma determinista (sin depender de la IA en ningún turno).
