# SmartPrompts — contexto y visión del proyecto

Documento de traspaso, escrito el 2026-07-25 para poder retomar este proyecto en otro chat sin perder contexto. Si estás leyendo esto como Claude en una sesión nueva: leé todo antes de tocar código, el usuario es junior y prefiere ir con calma, brainstorm antes que código.

## Qué es esto

App de escritorio (Windows, Electron) para armar y editar prompts de IA con voz y capturas de pantalla citadas. **Es un proyecto educativo / de portfolio para el currículum del usuario — no un producto para usuarios finales.** Prioridad: aprendizaje y demostrar buenas prácticas por encima de pulido pixel-perfect. Repo: `https://github.com/Menesex/SmartPrompts` (privado o público, root en `C:\Users\jjmen\OneDrive\Documentos\Software\SmartPrompts`).

## Estado actual — MVP funcionando

Corre con `npm start` (o `env -u ELECTRON_RUN_AS_NODE npm start` si lo lanza Claude desde su propia terminal — ver nota de entorno más abajo). API key de Groq del usuario ya configurada en `%APPDATA%\smartprompts\settings.json`.

### Arquitectura

```text
main.js       → proceso principal Electron: ventana, atajo global, bandeja,
                 handlers IPC (get-state, save-settings, test-connection,
                 transcribe, capture, send, copy, hide, quit, toggle-pin)
core/         → lógica pura, sin saber de Electron (excepto delivery.js)
  tagEngine.js      parseo de [BRACKET] y {fotoN} con regex
  promptBuilder.js  arma el texto final (renumera citas, agrega leyenda)
  groqClient.js     ÚNICO archivo que habla con internet (refinePrompt,
                     transcribe, listModels) — fetch directo a Groq
  delivery.js       portapapeles + teclado simulado (nut.js) para pegar
                     automático en la app que estaba activa antes
  settings.js       lee/escribe settings.json en %APPDATA%\smartprompts
data/db.js    → historial en SQLite (node:sqlite, sin deps nativas).
                 Guarda cada envío (texto, fotos, tags) pero AÚN NO hay
                 ninguna pantalla que lo muestre — hueco conocido.
ui/           → renderer (ventana flotante), vanilla JS/HTML/CSS
  palette.html/css/js   la ventana: editor, dictado, captura, ajustes
  preload.js            puente seguro (contextBridge) — la API key nunca
                         llega al renderer
```

**No hay backend propio.** Groq's API cumple ese rol; el proceso principal de Electron hace de "lugar seguro" para la key (nunca se empaqueta en el renderer).

### Stack y decisiones ya tomadas (no re-discutir salvo que algo cambie)

- Electron + vanilla JS (el usuario sabe HTML/CSS/JS, no frameworks).
- Groq como único proveedor de IA: `openai/gpt-oss-120b` para refinar texto, `whisper-large-v3-turbo` para voz (idioma autodetectado, no forzado).
- SQLite vía `node:sqlite` (built-in, cero deps nativas) en vez de better-sqlite3.
- `electron-screenshots` para la captura de región.
- `@nut-tree-fork/nut-js` para simular teclado (el `@nut-tree/nut-js` original está descontinuado).
- Sintaxis de etiquetas: `[IMPORTANTE]`, `[ORDEN:1]`, `[CATEGORIA:x]`, `[RELACIONADO: ...]`, citas `{foto1}`, `{foto2}`... — un solo vocabulario para texto e imágenes.
- Tema visual: oscuro violeta fijo (no sigue el tema de Windows), inspirado en Raycast pero no copiado. Paleta en `ui/palette.css` (`--accent: #b455f0`, fondo `#16121f`/`#0d0b13`).
- IA en modo pasivo (no hace preguntas de vuelta) — el modo activo (que pregunte para afinar el prompt) quedó anotado como feature real, pendiente de cuándo vale la pena construirlo.

### Ya se probó y funciona (validado por el usuario)

- Pegado automático de texto + imágenes en Gemini (navegador), Claude Code (VS Code) y DeepSeek (Brave) — el mecanismo central del proyecto.
- Dictado por voz casi en tiempo real, con corte por silencio real (no por tiempo fijo) para evitar que Whisper alucine frases repetidas.
- Comandos de voz mientras dictás ("etiqueta importante" → inserta `[IMPORTANTE]`), detectados aunque estén en medio de una oración.
- Ventana redimensionable, botón de fijar (no ocultarse sola), atajo global configurable desde Ajustes (selector con opciones seguras, no texto libre).
- Botón "Copiar" (Plan B): arma el mismo resultado pero solo al portapapeles, sin pegar en ninguna ventana — para probar sin efectos secundarios.

### Bug abierto, sin resolver

A veces, tras capturar una foto y citarla, la entrega final muestra `(imagen {fotoN} no disponible)` en vez de adjuntarla — la causa no se pudo identificar revisando el código (la lógica de `core/promptBuilder.js` parece correcta). Falta reproducirlo con más detalle: ¿estaba dictando por voz al mismo tiempo? ¿cuántas fotos había en la sesión?

### Nota de entorno para Claude

Si Claude lanza la app desde su propia terminal (Bash tool), esa terminal suele tener `ELECTRON_RUN_AS_NODE=1` seteado, lo que rompe `electron .` (corre como Node plano, `app` sale `undefined`). Solución: `env -u ELECTRON_RUN_AS_NODE npm start`. Además, la app queda viva en la bandeja del sistema (no se cierra sola al cerrar la ventana) — antes de relanzar tras editar código, matar la instancia vieja: buscar el proceso `electron.exe` cuyo CommandLine NO tenga `--type=` (ese es el proceso principal) y matarlo, si no el atajo global puede quedar tomado por la instancia vieja.

## LA VISIÓN NUEVA — lo más importante para retomar (2026-07-25)

Esto es un giro grande respecto al diseño original y es lo próximo a construir.

**Idea original (ya construida):** una ventana palette separada donde componés el prompt y después se pega automático en la app que tenías abierta.

**Idea nueva del usuario:** que SmartPrompts actúe **directamente donde ya estás escribiendo**, sin tener que saltar a otra ventana — un asistente en el lugar, no un destino aparte. Flujo que describió:

1. Seleccionás texto (en cualquier app: un chat de IA, un editor, lo que sea) y activás el asistente con una combinación de teclas (personalizable desde Ajustes — pedido explícito del usuario).
2. Aparece una cajita chica flotante cerca del mouse (no la palette completa) — potencialmente con botones que pueden "seguir al mouse" o quedarse fijos.
3. Le hablás o escribís una instrucción: "hazlo más elegante", "reordená por prioridad, lo importante primero", "agregá etiqueta importante", etc.
4. Groq transforma el texto seleccionado según la instrucción, y se pega en el mismo lugar reemplazando la selección.
5. También: activar dictado que escribe directamente en el campo donde tenés el cursor (no en una ventana de SmartPrompts), reconociendo comandos de voz ("etiqueta importante") igual que ya funciona en la palette grande.

**Cómo se puede construir (ya evaluado, viable con lo que ya tenemos):**
- Truco clave: simular **Ctrl+C** para capturar la selección de CUALQUIER app vía el portapapeles (no hace falta leer accesibilidad de Windows, que sería mucho más difícil). Transformar el texto del portapapeles con Groq, y simular **Ctrl+V** para devolverlo — es el mismo mecanismo que ya está probado y funcionando en `core/delivery.js`, aplicado desde un disparador distinto.
- Esto reusa casi todo lo ya construido: `groqClient.js`, el motor de comandos de voz de `palette.js`, y la mecánica de pegado de `delivery.js`.

**Lo que NO es viable tal cual se imaginó, y por qué:**
- **Clic derecho universal en cualquier app** → no se puede interceptar de forma genérica desde Electron; requeriría una extensión de shell nativa de Windows, fuera de alcance. Sustituto: un atajo de teclado después de seleccionar texto (el usuario mismo lo propuso como alternativa).
- **Detección automática de "acabás de seleccionar texto en cualquier app"** (sin apretar nada) → tampoco es viable sin APIs de accesibilidad pesadas (UI Automation de Windows). El disparador realista sigue siendo un atajo deliberado.
- Los **botones que siguen al mouse** sí son viables (ventana Electron que se reposiciona sola).

**Alcance recomendado para la primera versión (todavía no construido, quedó en pausa por límite de contexto de esta sesión):**
1. Nuevo atajo global, **configurable desde Ajustes** (igual que ya existe para abrir/cerrar la palette), que actúa sobre texto seleccionado en cualquier app.
2. Al activarse: simular Ctrl+C, leer el portapapeles, mostrar una cajita chica (no la palette completa) cerca del mouse con un input de texto + micrófono.
3. Mandar {texto seleccionado + instrucción} a Groq con un system prompt específico para "transformar este texto según esta instrucción" (distinto al de refinar prompts completos).
4. Pegar el resultado en el mismo lugar (reemplaza la selección) usando el mecanismo ya probado de `delivery.js`.
5. Recién en una segunda vuelta: los botones flotantes que siguen al mouse, el modo "dictar directo en el campo donde estás" sin selección previa.

La palette grande actual **no se reemplaza** — sigue sirviendo para prompts largos compuestos con capturas citadas. El modo nuevo es un segundo modo, más liviano, para ediciones rápidas en el lugar.

## Qué pedirle a un chat nuevo de Claude

Pegale este archivo (`VISION.md`) o decile que lo lea desde `C:\Users\jjmen\OneDrive\Documentos\Software\SmartPrompts\VISION.md`, y después pedile específicamente construir el punto "Alcance recomendado para la primera versión" de arriba — ese es el siguiente paso concreto.

Cuando el usuario esté conforme con las funcionalidades y quiera publicar/distribuir: hay dos niveles pendientes, explícitamente pausados hasta que el producto esté más maduro —
1. Pulir el README con capturas/GIF para que el repo se entienda a simple vista.
2. Empaquetar con `electron-builder` para generar un instalador `.exe` real y subirlo como GitHub Release, para que se pueda descargar sin clonar el repo ni tener Node instalado.
