# Guía de aceptación — Math IA (los 4 temas núcleo)

Esta guía define **cómo probar** los cuatro temas del alcance acordado (ecuaciones lineales,
derivadas, factorización y fracciones) y **qué debe responder** el sistema en cada caso. Todas las
frases de abajo están **verificadas en producción**: se ejecutan automáticamente con
`node qa/aceptacion.mjs` (ver al final).

## Cómo usarla

Escribe cada frase en el cuadro **"Tu consulta"** (o usa los botones de ejemplo) y pulsa
**Reproducir**. Puedes escribirlas **en orden**: el sistema recuerda el tema activo, así que
"otro ejemplo", "más difícil" o "no entendí" se aplican al tema en el que estás.

> Nota: la primera consulta tras un rato de inactividad puede tardar ~50 s (el hosting gratuito
> "despierta" el servicio). Las siguientes son inmediatas.

## Las 6 formas de preguntar (valen para los 4 temas)

| Lo que el cliente escribe | Qué hace el sistema |
|---|---|
| **"Explícame [el tema]"** | Enseña el **concepto**, la regla y un ejemplo resuelto + práctica |
| **"Explícalo con ejemplos de la vida cotidiana"** | Explica con un **caso real** (el significado), no solo números |
| **"Proponme un problema más difícil"** | Da un ejercicio **de verdad más difícil** |
| **"Ahora uno más fácil"** | Da uno **más sencillo** |
| **"Dame otro ejemplo"** | Presenta **otro** ejemplo distinto (rota, no repite) |
| **"No entendí, explícalo mejor"** | **Re-enseña** con un enfoque concreto distinto |

## 1) Ecuaciones lineales

`Explícame las ecuaciones lineales` · `Explícalo con ejemplos de la vida cotidiana` ·
`Proponme un problema más difícil` · `Ahora uno más fácil` · `Dame otro ejemplo` ·
`No entendí, explícalo mejor`

Ej.: concepto → `a·x + b = c`; vida real → *"compraste 3 cuadernos, pagaste 20…"*; más difícil → `4x + 3x - 5 = 30`.

## 2) Derivadas

`Enséñame las derivadas` · `Dame un ejemplo de la vida real` ·
`Proponme un problema más difícil` · `Ahora uno más fácil` · `Dame otro ejemplo` ·
`No entendí, explícalo mejor`

Ej.: vida real → *"la velocidad es la derivada de la posición: s(t)=t² → v(t)=2t"*; más difícil → `3x⁴ - 2x²`.

## 3) Factorización (diferencia de cuadrados)

`Explícame la factorización` · `Explícalo con ejemplos de la vida cotidiana` ·
`Proponme un problema más difícil` · `Ahora uno más fácil` · `Dame otro ejemplo` ·
`No entendí, explícalo mejor`

Ej.: concepto → `x² - 9 = (x-3)(x+3)`; vida real → *"el área que sobra al recortar un cuadrado"*; más difícil → `4x² - 25`.

## 4) Fracciones

`Enséñame las fracciones` · `Dame un ejemplo de la vida real` ·
`Proponme un problema más difícil` · `Ahora uno más fácil` · `Dame otro ejemplo` ·
`No entendí, explícalo mejor`

Ej.: vida real → *"repartir una pizza: 3/8 + 2/8 = 5/8"*; más difícil → denominadores distintos `1/2 + 1/3`.

## Garantía (en estos 4 temas)

- **Determinista**: el cálculo lo garantiza el sistema, no la IA (respuesta siempre correcta).
- **Coherente**: lo que dice la voz coincide con lo que aparece en la pizarra.
- **Calificable**: cada lección termina con un ejercicio que el sistema corrige.

## Verificación automática

`node qa/aceptacion.mjs` ejecuta, contra el sistema en vivo, las 4 × 6 = 24 interacciones de esta
guía y comprueba **de forma independiente** que: (1) la respuesta es matemáticamente correcta,
(2) la pizarra coincide con la voz (sin contradicciones), (3) la lección es determinista y
(4) la práctica no revela la respuesta. Se puede apuntar a otra URL con
`MATHIA_URL=https://… node qa/aceptacion.mjs`.

## Fuera de esta guía

Los temas **fuera de los cuatro** (cuadráticas, trigonometría, integrales, etc.) son de mejor
esfuerzo vía IA y no forman parte del alcance garantizado de las Etapas 1 y 2.
