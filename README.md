# SmartPrompts

Command palette de escritorio (Windows) para armar prompts de IA con voz, capturas de pantalla citadas (`{foto1}`, `{foto2}`...) y etiquetas `[BRACKET]` (`[IMPORTANTE]`, `[ORDEN:1]`, `[RELACIONADO: ...]`).

Estado actual: **spike técnico**, no la app final. Ver más abajo.

## Spike: ¿se puede simular el pegado de una imagen en Gemini / Claude Code / DeepSeek?

Antes de construir la app completa, hay que validar la parte más frágil del plan: si SmartPrompts puede copiar una imagen al portapapeles y "pegarla" automáticamente en la ventana que estabas usando (un chat de IA de un tercero). Esta carpeta tiene el mínimo código para probarlo.

### Cómo correr la prueba

```
npm install
npm start
```

Se abre una ventanita con instrucciones. Dejala abierta (podés minimizarla).

### Cómo probar

1. Abrí la app que querés probar: Gemini en el navegador, Claude Code en VS Code, o DeepSeek en Brave.
2. Hacé clic dentro de la caja de texto del chat para que tenga el foco.
3. Sin tocar la ventana de SmartPrompts, apretá **Alt+Shift+V**.
4. Fijate si apareció un cuadrado violeta pegado como imagen adjunta en esa caja de chat.
5. Anotá el resultado (sirve, no sirve, o "sirve pero con rarezas") para cada una de las 3 apps.

Los logs de cada intento (si se copió la imagen, si se simuló el Ctrl+V) aparecen en la terminal donde corriste `npm start`.

### Qué significa el resultado

- **Si funciona en las 3:** el plan de "autopegado automático de texto + imágenes" es viable tal cual se pensó — se puede seguir con el resto de la arquitectura.
- **Si funciona en algunas pero no en todas:** SmartPrompts usa autopegado donde funcione, y cae al **Plan B** (copiar la imagen al portapapeles y que el usuario la pegue con Ctrl+V manualmente) en las que no.
- **Si no funciona en ninguna:** el Plan B (copiar al portapapeles, pegado manual) pasa a ser el comportamiento principal, no solo el respaldo.

## Roadmap

1. **Fase 1 (MVP):** palette flotante + Groq (texto y voz) + SQLite local. Sin backend.
2. **Fase 2:** etiquetas por voz, instrucciones rápidas sobre selección, citas de foto, galería de capturas con etiquetas Planner-style.
3. **Fase 3:** backend + hosting gratuito opcional, solo para sincronizar entre dispositivos.
4. **Fase 4:** móvil.
