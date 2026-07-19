// Cliente de la API de Groq (texto y voz). Todas las llamadas de red viven en el
// proceso principal: la API key nunca llega al renderer.

const BASE_URL = 'https://api.groq.com/openai/v1';

const SYSTEM_PROMPT = `Eres el motor interno de SmartPrompts, una app que ayuda a redactar prompts claros para otras IAs.
Recibirás el borrador de un prompt escrito o dictado por una persona. Puede incluir etiquetas entre corchetes como [IMPORTANTE], [ORDEN:1], [CATEGORIA:trabajo], [RELACIONADO: ...] y citas de imágenes como {foto1}.
Tu tarea: devolver el mismo prompt mejor redactado — corrige errores de dictado y puntuación, ordena las ideas y hazlo más claro y directo.
Reglas estrictas:
- Conserva la intención original. No inventes información ni agregues pedidos nuevos.
- Conserva TODAS las etiquetas [ASI] y citas {fotoN} exactamente como están, junto al contenido al que acompañan.
- Mantén el idioma original del texto.
- Si el texto ya está claro, haz solo ajustes mínimos.
- Responde SOLO con el prompt mejorado: sin explicaciones, sin comillas, sin bloques de código.`;

async function api(pathname, { apiKey, ...init }) {
  const res = await fetch(BASE_URL + pathname, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq respondió ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

async function refinePrompt(text, { apiKey, model }) {
  const res = await api('/chat/completions', {
    apiKey,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });
  const data = await res.json();
  let out = (data.choices?.[0]?.message?.content || '').trim();
  out = out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  return out || text;
}

async function transcribe(buffer, { apiKey, language = 'es' }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/webm' }), 'dictado.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', language);
  form.append('response_format', 'json');
  const res = await api('/audio/transcriptions', { apiKey, method: 'POST', body: form });
  const data = await res.json();
  return (data.text || '').trim();
}

async function listModels({ apiKey }) {
  const res = await api('/models', { apiKey });
  const data = await res.json();
  return (data.data || []).map((m) => m.id).sort();
}

module.exports = { refinePrompt, transcribe, listModels };
