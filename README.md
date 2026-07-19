# SmartPrompts

Command palette de escritorio (Windows) para armar buenos prompts de IA sin fricción: apretás un atajo global sobre cualquier app, escribís o **dictás** tu idea, citás **capturas de pantalla** dentro del texto (`{foto1}`), marcás prioridades con etiquetas `[BRACKET]`, y SmartPrompts lo refina con IA y lo **pega automáticamente** — texto + imágenes adjuntas — en el chat que estabas usando (Gemini, Claude Code, DeepSeek…).

> Estado: **MVP en construcción.** El mecanismo de entrega (pegado automático de texto + imágenes en apps de terceros) fue validado el 2026-07-19 en Gemini (navegador), Claude Code (VS Code) y DeepSeek (Brave).

## Cómo se usa

1. `npm install` y `npm start` (requiere Node 18+).
2. Conseguí una API key **gratis** de Groq en [console.groq.com/keys](https://console.groq.com/keys) y pegala en ⚙ → Guardar. *(Sin key la app igual entrega tu texto y fotos, pero sin refinado por IA ni dictado por voz.)*
3. Andá a cualquier app (un chat de IA, tu correo…) y apretá **Alt+Espacio**. Si ese atajo estuviera ocupado, la ventana te muestra cuál quedó activo.
4. Escribí tu idea, o dictala con 🎤. Con el botón de captura seleccionás una región de pantalla y se cita en el texto como `{foto1}`.
5. **Ctrl+Enter**: SmartPrompts refina el texto con Groq, vuelve a la app donde estabas, pega el prompt y adjunta las imágenes citadas, en orden. Vos revisás y apretás enviar.

`Esc` esconde la ventana (el borrador no se pierde). La app queda viva en la bandeja del sistema; se cierra desde ⚙ → *Cerrar SmartPrompts* o desde la bandeja.

## Etiquetas `[BRACKET]`

Una sola convención para texto e imágenes, coloreada en vivo en el editor:

| Etiqueta | Significado |
| --- | --- |
| `[IMPORTANTE]` | máxima prioridad |
| `[ORDEN:1]` | orden de lectura/ejecución |
| `[CATEGORIA:trabajo]` | clasificación tipo Planner |
| `[RELACIONADO: ...]` | vincula con otra parte o imagen |
| `{foto1}` | cita la captura N.º 1 |

Al entregar, `{fotoN}` se convierte en "(ver imagen N adjunta)" y se agrega al final una leyenda breve para que la IA destino entienda las convenciones.

## Arquitectura

```text
main.js        → wiring de Electron: ventana, atajo global, bandeja, IPC
core/          → el cerebro (sin saber nada de ventanas)
  tagEngine.js     → parseo de etiquetas [BRACKET] y citas {fotoN}
  promptBuilder.js → arma el texto final a entregar (renumera citas, agrega leyenda)
  groqClient.js    → API de Groq: refinado (chat) y dictado (Whisper)
  delivery.js      → devuelve el foco y pega texto + imágenes con el teclado simulado
  settings.js      → ajustes locales (API key, modelo)
data/
  db.js            → historial en SQLite (node:sqlite, sin dependencias nativas)
ui/
  palette.html/css/js → la ventana flotante (vanilla JS)
  preload.js          → puente seguro renderer ↔ main (la API key nunca sale de main)
```

Datos del usuario (ajustes, historial, capturas) viven en `%APPDATA%/smartprompts`, fuera del repo.

## Roadmap

- [x] Spike: validar pegado automático de imágenes en apps de terceros
- [ ] **Fase 1 (MVP)** — palette + refinado Groq + dictado + captura citada + entrega + historial SQLite *(en pruebas)*
- [ ] Fase 2 — etiquetas por comando de voz, instrucciones sobre selección, galería de capturas con versiones
- [ ] Fase 3 — sync opcional entre dispositivos (backend gratuito)
- [ ] Fase 4 — móvil
