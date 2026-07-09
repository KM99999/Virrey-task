# Proyecto "Math IA" — Registro del Diálogo Cliente–Freelancer

> Prototipo web funcional de IA educativa: consultas matemáticas por texto/voz, clasificador de intención, IA generativa con salida estructurada (LSG), avatar con voz en español, motores PRE Light y PSE Light, historial y despliegue.
>
> **Freelancer:** Joao · **Presupuesto final:** USD 90 · **Plazo:** ~2 semanas (2 fases)

---

## 1. Publicación original del proyecto (Cliente)

**Título:** Math IA — Prototipo web funcional
**Presupuesto:** USD 50 – 100 · **Categoría:** IT & Programming / Artificial Intelligence · **Tamaño:** Small

Se busca un freelancer o equipo para desarrollar un prototipo web funcional denominado **"Math IA"**. El objetivo principal es crear una demostración web interactiva donde los alumnos puedan realizar consultas matemáticas, ya sea escribiendo o utilizando comandos de voz. El sistema deberá procesar estas entradas, identificar la intención del usuario y generar respuestas pedagógicas guiadas por un avatar visual básico.

### Funcionalidades clave
- Página web simple y completamente funcional.
- Implementación de un avatar visual básico (no se requiere 3D avanzado).
- Capacidad de entrada de texto para las consultas matemáticas.
- Funcionalidad de entrada de voz con conversión de voz a texto.
- Integración mediante API con una IA generativa para el procesamiento de consultas.
- Desarrollo de un clasificador básico de intención para discernir entre: resolver ejercicios, aprender un tema, solicitar una explicación o pedir un ejercicio de práctica.
- Un **Motor de Resolución Pedagógica (PRE Light)** para transformar las respuestas de la IA en pasos didácticos o módulos de aprendizaje.
- Un **Motor de Sincronización Pedagógica (PSE Light)** para coordinar la explicación del avatar con la aparición progresiva del contenido en pantalla.
- Voz del avatar configurada en español.
- Un historial simple para registrar las interacciones de la sesión.
- Manejo básico de errores para una experiencia de usuario fluida.
- Despliegue del prototipo en un ambiente de prueba.
- Entrega completa del código fuente y la documentación técnica del proyecto.

### Funcionamiento esperado
- **Para resolución de ejercicios:** Si un alumno introduce "Resuelve 2x + 5 = 15", la IA generará una solución matemática base. Posteriormente, el PRE Light la estructurará en pasos didácticos. Se mostrará primero la secuencia de pasos y luego el avatar explicará cada uno, mientras el contenido matemático se revela progresivamente en la pantalla.
- **Para aprendizaje de temas:** Si un alumno introduce "Enséñame derivadas", la IA generará contenido conceptual. El PRE Light lo transformará en módulos pedagógicos (concepto, regla, ejemplo guiado y ejercicio de práctica). El avatar explicará cada módulo y el contenido se revelará de forma progresiva en la pantalla.

**Skills:** Python · JavaScript · HTML5 · CSS3 · API · Machine Learning · NLP · Database · Artificial Intelligence · React.js · Node.js

---

## 2. Propuesta / Bid (Joao) — USD 66.56

Olá Virrey,

Um protótipo web funcional 'Math IA': uma demo interativa onde o aluno faz consultas matemáticas por texto ou voz, o sistema identifica a intenção (resolver exercício, aprender tema, pedir explicação ou praticar), integra uma IA generativa via API, e um avatar visual básico explica em espanhol enquanto o conteúdo aparece progressivamente na tela, coordenado por um motor de resolução pedagógica (PRE Light) e um de sincronização (PSE Light).

É exatamente o tipo de protótipo de IA educacional que faço, e onde o valor está menos em "chamar a API" e mais na sincronização entre a fala do avatar e a revelação do conteúdo, que é o que faz a demo parecer mágica ou parecer quebrada.

O caminho que costumo seguir começa justamente pela camada onde esse protótipo silenciosamente falha: a estrutura da resposta da IA antes de exibi-la. O erro comum é jogar o texto cru da IA generativa direto na tela, e aí os "passos didáticos" saem inconsistentes, às vezes 3 passos, às vezes um parágrafo só, e o motor de sincronização não tem o que coordenar. Resolvo isso forçando a IA a devolver saída estruturada (JSON com passos ou módulos claramente delimitados) via prompt bem desenhado, para que o PRE Light sempre receba blocos previsíveis: "Resuelve 2x + 5 = 15" vira sempre uma sequência ordenada de passos, e "Enséñame derivadas" vira sempre módulos (conceito, regra, exemplo guiado, prática). Sem essa estrutura confiável, o resto do sistema não tem chão.

Depois vêm as duas engrenagens que dão vida à experiência. A sincronização avatar-conteúdo (PSE Light): o ponto fino é o timing — o avatar precisa falar em espanhol e o conteúdo aparecer no ritmo certo, senão a explicação fica dessincronizada da tela e confunde o aluno; coordeno isso por eventos (cada bloco do PRE dispara a fala via síntese de voz e a revelação visual em sincronia), para a progressão ser fluida. E o classificador de intenção mais a entrada por voz: estruturo o classificador para distinguir de forma confiável as quatro intenções (resolver, aprender, explicar, praticar), porque é ele que decide se a resposta vira passos ou módulos, e integro a conversão de voz para texto (Web Speech API) com tratamento básico de erro, para que uma consulta falada mal reconhecida não trave a experiência.

Uma observação sobre escopo: sendo um protótipo, vale separar a fase do núcleo funcional (entrada texto/voz, classificador de intenção, integração da IA com saída estruturada e o PRE Light transformando em passos/módulos) da fase da camada pedagógica visível (avatar com voz em espanhol, o PSE Light sincronizando fala e revelação progressiva, histórico da sessão e deploy no ambiente de teste). O esforço inicial é maior, e depois o ritmo cai bastante. Posso propor as duas fases em blocos separados se fizer sentido pra você, com entrega do código-fonte completo e documentação técnica, como você pediu.

**Orçamento: USD 65 | Prazo: 1-2 semanas** — Estimativa de trabalho; o escopo final e o ritmo a gente ajusta junto.

Um ponto que ajuda a fechar com precisão: qual IA generativa você quer usar (por exemplo, a API da OpenAI, Claude ou Gemini) e se você fornece a chave/conta, porque isso define a integração e o custo de operação da demo. Se quiser, posso compartilhar o checklist de protótipo de IA educacional que uso como ponto de partida, e te mostro como estruturo a saída da IA para o PRE Light, pra você julgar a qualidade antes de fechar qualquer coisa.

Abraço, JOAO

---

## 3. Cliente propone el "Learning Scene Graph (LSG)"

> ¿Crees que en lugar de utilizar JSON, puedas utilizar un **Learning Scene Graph (LSG)**? Que contenga: Responde.

```
ESCENA 1
Duración: 3 minutos
Avatar: Sonríe
Pizarra: Mostrar función
Hablar: "Hola..."
Esperar: 2 segundos
Escribir: f(x)=x²
Mover puntero / Resaltar
Preguntar: "¿Qué observas?"
Esperar respuesta
  Si responde correctamente → Continuar
  Si responde mal → Mostrar otro ejemplo
```

### Respuesta (Joao)

Hola, sí, y me gusta más tu enfoque que el JSON plano. Lo que describes como LSG es exactamente la estructura que el PSE Light necesita: no es una alternativa al JSON, es un JSON mejor diseñado — un grafo de escenas que la IA genera y el motor de sincronización reproduce como una línea de tiempo. Cada escena es una lista ordenada de directivas (avatar, pizarra, hablar, esperar, escribir, preguntar) con su timing, y el avatar en español ejecuta esa secuencia mientras el contenido aparece progresivamente en pantalla.

Tu ejemplo se traduciría a algo así:

```json
{ "escena": 1, "duracion": 180,
  "directivas": [
   {"tipo":"avatar", "accion":"sonreir"},
   {"tipo":"hablar", "texto":"Hola..."},
   {"tipo":"esperar", "segundos":2},
   {"tipo":"pizarra", "accion":"escribir", "contenido":"f(x)=x²"},
   {"tipo":"puntero", "accion":"resaltar"},
   {"tipo":"preguntar", "texto":"¿Qué observas?", "esperar_respuesta":true,
     "si_correcto":"continuar", "si_incorrecto":"mostrar_otro_ejemplo"} ]}
```

La IA generativa llena esa estructura y el PSE Light la ejecuta directiva por directiva, sincronizando la voz del avatar con la revelación del contenido.

**Nota de alcance:** la estructura LSG y la reproducción secuencial entran bien dentro del prototipo. La parte de ramificación real — evaluar la respuesta del alumno y decidir "si responde mal → otro ejemplo" — es lo único que agrega complejidad de verdad. Propongo incluir una versión ligera en la v1 (un reintento / un ejemplo alternativo) y dejar la ramificación más rica como fase 2.

**Pregunta clave:** ¿qué IA generativa quieres usar (OpenAI, Claude o Gemini) y provees tú la clave/cuenta?

---

## 4. Estimación de tiempo

**Cliente:** ¿Cuánto tiempo necesitas para culminar el proyecto?

**Joao:** ~2 semanas, dividido en dos entregas:
- **Semana 1 — núcleo funcional:** entrada por texto y voz, clasificador de intención, integración de la IA con salida estructurada en LSG, y el PRE Light generando las escenas/pasos. Punto de control al terminar.
- **Semana 2 — capa pedagógica visible:** avatar con voz en español, PSE Light reproduciendo el LSG, ramificación ligera, historial de sesión, manejo de errores y despliegue. Entrega de código fuente + documentación.

Único factor que mueve la fecha: la clave/cuenta de la IA generativa al inicio.

---

## 5. Ajuste de presupuesto → USD 90

**Contexto (nota de decisión):** El aumento de USD 65 → USD 90 se ancla en escopo nuevo real: el LSG es una estructura más rica que la salida plana original, y la ramificación condicional ("si responde bien / mal → otro ejemplo") agrega lógica de decisión no incluida en la propuesta inicial. Alternativa ofrecida: mantener ~USD 65 con el LSG en versión secuencial (sin ramificación).

**Cliente:** Dame un detalle de lo que entregarás con el presupuesto de 90 dólares. Me parece que es tu mejor propuesta técnica que la de 65 dólares.

---

## 6. Precisiones a cumplir por Joao (tabla de acuerdo del cliente)

| Punto | Confirmar qué debe: |
|---|---|
| **Código fuente** | Entregar todo el código fuente, no solo el despliegue. |
| **Repositorio** | Subir a GitHub, GitLab o ZIP ordenado. |
| **API Key** | La clave de IA irá en variable de entorno, no escrita dentro del código. |
| **LSG** | Mostrar un ejemplo de la estructura LSG que usará. |
| **Fase 1 validable** | Al terminar Fase 1 se podrá probar texto, voz, clasificador, IA y salida LSG. |
| **Fase 2 validable** | Al terminar Fase 2 se podrá ver al avatar, escuchar la voz, ver pasos sincronizados y pizarra básica. |
| **Documentación** | Incluir instrucciones para instalar, ejecutar y configurar la API. |
| **Despliegue** | Dejar el prototipo funcionando en un enlace de prueba. |
| **Correcciones** | Incluir corrección de errores básicos después de la entrega final. |

---

## 7. Detalle de entregables por USD 90 (Joao)

### Núcleo funcional (Fase 1)
- Página web simple y funcional
- Entrada de consultas por texto
- Entrada por voz con conversión voz-a-texto (Web Speech API) y manejo de errores de reconocimiento
- Clasificador de intención: distingue las 4 intenciones (resolver ejercicio, aprender tema, pedir explicación, pedir práctica)
- Integración vía API con la IA generativa
- Salida estructurada en formato **LSG (Learning Scene Graph)**: escenas ordenadas con directivas (avatar, pizarra, hablar, esperar, escribir, preguntar) y su timing
- **PRE Light:** transforma la respuesta de la IA en pasos didácticos (ejercicios) o módulos (temas: concepto, regla, ejemplo guiado, práctica)

### Capa pedagógica visible (Fase 2)
- Avatar visual básico (2D, sin 3D avanzado)
- Voz del avatar en **español** (TTS)
- **PSE Light:** reproduce el LSG sincronizando la voz del avatar con la revelación progresiva del contenido y las acciones de pizarra
- **Ramificación ligera:** el avatar pregunta, evalúa la respuesta del alumno y decide entre continuar o mostrar un ejemplo alternativo (un reintento)
- Historial simple de la sesión
- Manejo básico de errores

### Entrega final
- Despliegue del prototipo en un ambiente de prueba
- Código fuente completo
- Documentación técnica del proyecto

**Plazo:** ~2 semanas, con punto de control al terminar la Fase 1.
**Requisito para arrancar:** clave/cuenta de la IA generativa (en variable de entorno).

---

## 8. Ejemplos de salida LSG

> El cliente solicitó un ejemplo concreto de salida LSG, mostrando su propio borrador de formato plano. Joao respondió con una versión de **directivas discretas** (cada acción es un evento independiente, lo que permite al PSE Light sincronizar con precisión en lugar de "por bloques").

### Ejemplo A — "Resuelve 2x + 5 = 15" (intención: resolver)

```json
{
  "escena": "resolver_ecuacion",
  "intencion": "resolver",
  "duracion_estimada": 60,
  "directivas": [
    { "id": 1, "tipo": "avatar", "accion": "sonreir" },
    { "id": 2, "tipo": "hablar", "texto": "Primero identificamos la ecuación." },
    { "id": 3, "tipo": "pizarra", "accion": "escribir", "contenido": "2x + 5 = 15" },
    { "id": 4, "tipo": "esperar", "segundos": 2 },
    { "id": 5, "tipo": "hablar", "texto": "Restamos 5 en ambos lados." },
    { "id": 6, "tipo": "pizarra", "accion": "escribir", "contenido": "2x = 10" },
    { "id": 7, "tipo": "puntero", "accion": "resaltar", "objetivo": "2x = 10" },
    { "id": 8, "tipo": "hablar", "texto": "Dividimos entre 2." },
    { "id": 9, "tipo": "pizarra", "accion": "escribir", "contenido": "x = 5" },
    { "id": 10, "tipo": "preguntar", "texto": "¿Entendiste este paso?",
      "esperar_respuesta": true,
      "si_correcto": "continuar",
      "si_incorrecto": "mostrar_otro_ejemplo" }
  ]
}
```

### Ejemplo B — "Enséñame derivadas" (intención: aprender)

```json
{
  "escena": "aprender_derivadas",
  "intencion": "aprender",
  "duracion_estimada": 180,
  "modulos": [
    { "id": "concepto", "directivas": [
      { "tipo": "hablar", "texto": "Una derivada mide cómo cambia una función." },
      { "tipo": "pizarra", "accion": "escribir", "contenido": "f'(x) = lim..." }
    ]},
    { "id": "regla", "directivas": [
      { "tipo": "hablar", "texto": "La regla de la potencia: baja el exponente." },
      { "tipo": "pizarra", "accion": "escribir", "contenido": "d/dx[xⁿ] = n·xⁿ⁻¹" }
    ]},
    { "id": "ejemplo_guiado", "directivas": [
      { "tipo": "pizarra", "accion": "escribir", "contenido": "f(x) = x³ → f'(x) = 3x²" }
    ]},
    { "id": "practica", "directivas": [
      { "tipo": "preguntar", "texto": "¿Cuál es la derivada de x²?",
        "esperar_respuesta": true,
        "si_correcto": "felicitar",
        "si_incorrecto": "mostrar_otro_ejemplo" }
    ]}
  ]
}
```

### Dos decisiones de diseño clave
1. **Directivas discretas** → dan al PSE Light eventos exactos para sincronizar voz y contenido.
2. **Ramificación integrada** en la directiva `preguntar` (`si_correcto` / `si_incorrecto`) → parte del esquema, no un añadido.

---

## 9. Estado final

- ✅ Proyecto **aceptado** por el cliente.
- 💵 Presupuesto cerrado: **USD 90**.
- 📦 Alcance fijado (secciones 6, 7 y 8).
- 🔑 Único requisito para arrancar: **API key de la IA generativa** (OpenAI / Claude / Gemini) en variable de entorno.
- ▶️ Inicio con la **Fase 1** (núcleo funcional).

---

## Anexo — Notas de estrategia (uso interno)

- **Aumento de precio:** justificado por escopo nuevo (LSG + ramificación), no por preferencia. Hecho antes de comenzar, no a mitad de desarrollo.
- **Compromiso ~2 semanas con hitos:** entregar la Fase 1 antes de lo prometido (under-promise / over-deliver) sin bajar el número comprometido.
- **Reparto IA vs. manual:** la IA acelera ~60-70% del código (UI, voz-a-texto, TTS, prompts del clasificador, integración). Lo manual y de mayor valor: sincronización fina (PSE Light), fiabilidad del LSG, ramificación, integración y deploy.
- **Límite de alcance:** la ramificación de la v1 es **ligera (un reintento)**. Árboles de decisión más ricos = conversación de fase 2.
- **"Clave" = API key** (credencial de acceso a la IA, no relacionado con "poema"). Va siempre en variable de entorno.
