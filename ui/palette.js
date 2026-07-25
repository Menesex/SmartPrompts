// Lógica de la ventana flotante. Solo pinta y delega: todo el trabajo real
// (Groq, captura, entrega, historial) pasa por window.smartprompts → proceso principal.

// Copias de las regex de core/tagEngine.js (el renderer no puede hacer require).
const TAG_RE = /\[(IMPORTANTE|ORDEN|CATEGORIA|RELACIONADO)(?:\s*:\s*([^\]]*))?\]/gi;
const FOTO_RE = /\{foto(\d+)\}/gi;

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const highlights = $('highlights');
const statusEl = $('status');
const photoStrip = $('photoStrip');
const micBtn = $('micBtn');
const camBtn = $('camBtn');
const sendBtn = $('sendBtn');
const copyBtn = $('copyBtn');
const settingsPanel = $('settings');
const helpPanel = $('help');

let fotos = []; // { numero, path } de la sesión actual
let proximoNumero = 1;
let grabando = false;
let micStream = null;
let estado = { hotkey: '…', model: '', hasKey: false };

/* ---------- estado / status ---------- */

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

window.smartprompts.onStatus(setStatus);

const NOMBRE_ATAJO = (a) => a.replace('Space', 'Espacio');

async function cargarEstado() {
  estado = await window.smartprompts.getState();
  $('hotkeyChip').textContent = NOMBRE_ATAJO(estado.hotkey);
  $('modelBadge').textContent = `groq · ${estado.model}`;
  micBtn.disabled = !estado.hasKey;
  micBtn.title = estado.hasKey
    ? 'Dictar por voz — se va escribiendo solo mientras hablás'
    : 'Para dictar, configurá tu API key de Groq en ⚙';
  $('modelInput').value = estado.model;
  $('apiKeyInput').placeholder = estado.hasKey
    ? '•••••• ya configurada — pegá una nueva solo para reemplazarla'
    : 'gsk_...';

  const hotkeySelect = $('hotkeySelect');
  hotkeySelect.innerHTML = (estado.atajosDisponibles || [estado.hotkey])
    .map((a) => `<option value="${a}">${NOMBRE_ATAJO(a)}</option>`)
    .join('');
  hotkeySelect.value = estado.hotkey;

  actualizarPin(estado.fijada);
}

function actualizarPin(fijada) {
  $('pinBtn').classList.toggle('active', fijada);
  $('pinBtn').title = fijada
    ? 'Fijada — hacé clic para que vuelva a ocultarse sola al perder el foco'
    : 'Fijar: mantener esta ventana abierta aunque hagas clic afuera';
}

$('pinBtn').addEventListener('click', async () => {
  const res = await window.smartprompts.togglePin();
  actualizarPin(res.fijada);
  setStatus(res.fijada ? 'ventana fijada 📌 — no se va a ocultar sola' : 'ventana ya no está fijada', 'ok');
});

/* ---------- coloreado en vivo de etiquetas ---------- */

const CLASE_TAG = { IMPORTANTE: 'hl-importante', ORDEN: 'hl-orden', CATEGORIA: 'hl-categoria', RELACIONADO: 'hl-relacionado' };

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pintar() {
  let html = escapeHtml(editor.value);
  html = html.replace(TAG_RE, (m, name) => `<span class="hl ${CLASE_TAG[name.toUpperCase()]}">${m}</span>`);
  html = html.replace(FOTO_RE, (m) => `<span class="hl hl-foto">${m}</span>`);
  highlights.innerHTML = html + '<br>'; // <br> final para que la última línea mida bien
  highlights.scrollTop = editor.scrollTop;
}

editor.addEventListener('input', pintar);
editor.addEventListener('scroll', () => { highlights.scrollTop = editor.scrollTop; });

function insertarEnCursor(texto) {
  editor.setRangeText(texto, editor.selectionStart, editor.selectionEnd, 'end');
  pintar();
  editor.focus();
}

/* ---------- fotos citadas ---------- */

function pintarStrip() {
  photoStrip.hidden = fotos.length === 0;
  photoStrip.innerHTML = '';
  for (const f of fotos) {
    const chip = document.createElement('span');
    chip.className = 'photo-chip';
    const img = document.createElement('img');
    img.src = 'file:///' + f.path.replace(/\\/g, '/');
    const label = document.createElement('span');
    label.textContent = `{foto${f.numero}}`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Quitar esta captura (borra también su cita del texto)';
    del.addEventListener('click', () => {
      fotos = fotos.filter((x) => x.numero !== f.numero);
      editor.value = editor.value.replaceAll(`{foto${f.numero}}`, '');
      pintar();
      pintarStrip();
    });
    chip.append(img, label, del);
    photoStrip.append(chip);
  }
}

camBtn.addEventListener('click', async () => {
  setStatus('seleccioná la región a capturar…');
  const res = await window.smartprompts.capture();
  if (res && res.path) {
    const numero = proximoNumero++;
    fotos.push({ numero, path: res.path });
    insertarEnCursor(`{foto${numero}} `);
    pintarStrip();
    setStatus(`captura {foto${numero}} agregada ✓`, 'ok');
  } else {
    setStatus('captura cancelada');
  }
});

/* ---------- dictado por voz, casi en tiempo real ---------- */
// Whisper (Groq) no hace streaming real: no existe transcripción palabra por
// palabra. Lo que sí podemos hacer es grabar en segmentos cortos (4s) uno
// detrás del otro y mandar cada uno a transcribir apenas termina — así el
// texto va apareciendo solo con un desfasaje chico, sin que el usuario tenga
// que pausar ni cortar la grabación.

// 6s en vez de 4s: menos cortes → menos probabilidad de partir una palabra
// justo en el límite de un segmento (a costa de un pelín más de desfasaje).
const DURACION_SEGMENTO_MS = 6000;
const TAMANO_MINIMO_BYTES = 800; // segmentos casi vacíos (silencio al frenar) no se mandan a transcribir
const UMBRAL_VOLUMEN = 12; // 0-255; si nunca se supera durante el segmento, no se manda a Groq

let indiceSegmento = 0;
let proximoAInsertar = 0;
const resultadosPendientes = new Map();

// Comandos de voz: a diferencia de la v1, ahora buscan la frase de comando
// EN CUALQUIER PARTE del segmento (no exigen que sea el segmento completo) —
// porque en la práctica casi nunca decís el comando solo, aislado en sus
// propios 6 segundos: lo pensás en voz alta en medio de la dictada. Cada
// coincidencia se reemplaza por la etiqueta, el resto del texto se conserva.
function aplicarComandosDeVoz(texto) {
  let antes;
  let out = texto;
  do {
    antes = out;
    out = out
      .replace(/\b(?:etiqueta|etiquetar|marca|marcar)\s+(?:esto\s+)?(?:como\s+)?importante\b[.,]?\s*/i, '[IMPORTANTE] ')
      .replace(/\b(?:etiqueta|etiquetar|marca|marcar)\s+categor[ií]a\s+([a-záéíóúñ0-9]+)\b[.,]?\s*/i, (_, palabra) => `[CATEGORIA:${palabra}] `)
      .replace(/\b(?:etiqueta|etiquetar|marca|marcar)\s+relacionado(?:\s+con)?\s+([^.,;]+)[.,]?\s*/i, (_, resto) => `[RELACIONADO: ${resto.trim()}] `);
  } while (out !== antes); // por si dijiste más de un comando en el mismo segmento
  return { texto: out, huboComando: out !== texto };
}

function insertarResultadosEnOrden() {
  while (resultadosPendientes.has(proximoAInsertar)) {
    const texto = resultadosPendientes.get(proximoAInsertar);
    resultadosPendientes.delete(proximoAInsertar);
    proximoAInsertar++;
    if (!texto) continue;
    const { texto: final, huboComando } = aplicarComandosDeVoz(texto);
    insertarEnCursor(final + (final.endsWith(' ') ? '' : ' '));
    if (huboComando) setStatus('comando de voz aplicado ✓', 'ok');
  }
}

// Un solo AudioContext por sesión de dictado (no uno por segmento) para medir
// si hubo volumen real en cada tramo de 6s. Si un segmento quedó en puro
// silencio/ruido de fondo bajo, ni se manda a transcribir — así dejar el
// micrófono prendido sin hablar no gasta cupo de Groq.
let audioCtx = null;
let analyser = null;
let monitorId = null;
let huboSonidoEnSegmento = false;

function iniciarMonitoreoDeVolumen(stream) {
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const datos = new Uint8Array(analyser.frequencyBinCount);
  monitorId = setInterval(() => {
    analyser.getByteFrequencyData(datos);
    const promedio = datos.reduce((a, b) => a + b, 0) / datos.length;
    if (promedio > UMBRAL_VOLUMEN) huboSonidoEnSegmento = true;
  }, 200);
}

function detenerMonitoreoDeVolumen() {
  clearInterval(monitorId);
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  analyser = null;
}

function grabarUnSegmento(stream) {
  huboSonidoEnSegmento = false;
  return new Promise((resolve) => {
    const partes = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    rec.addEventListener('dataavailable', (e) => { if (e.data.size) partes.push(e.data); });
    rec.addEventListener('stop', () => resolve({ blob: new Blob(partes, { type: 'audio/webm' }), huboSonido: huboSonidoEnSegmento }));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, DURACION_SEGMENTO_MS);
  });
}

async function transcribirSegmento({ blob, huboSonido }, idx) {
  if (!huboSonido || blob.size < TAMANO_MINIMO_BYTES) {
    resultadosPendientes.set(idx, ''); // segmento silencioso: no se gasta cupo de Groq en él
    insertarResultadosEnOrden();
    return;
  }
  const buffer = await blob.arrayBuffer();
  const res = await window.smartprompts.transcribe(buffer);
  if (!res.ok) setStatus(res.error || 'no se entendió un segmento', 'warn');
  resultadosPendientes.set(idx, res.ok ? res.text : '');
  insertarResultadosEnOrden();
}

async function cicloDeDictado(stream) {
  while (grabando) {
    const idx = indiceSegmento++;
    const segmento = await grabarUnSegmento(stream);
    transcribirSegmento(segmento, idx); // sin await: ya arranca el próximo segmento en paralelo
  }
}

micBtn.addEventListener('click', async () => {
  if (grabando) {
    grabando = false;
    micBtn.classList.remove('recording');
    setStatus('terminando de transcribir el último segmento…');
    micStream.getTracks().forEach((t) => t.stop()); // esto también corta la grabación del segmento actual
    detenerMonitoreoDeVolumen();
    return;
  }
  try {
    // echoCancellation/noiseSuppression: si tus auriculares "se escuchan doble"
    // o el mic capta el audio de la PC, esto debería atenuarlo bastante.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    grabando = true;
    indiceSegmento = 0;
    proximoAInsertar = 0;
    resultadosPendientes.clear();
    micBtn.classList.add('recording');
    setStatus('escuchando… el texto va apareciendo solo (clic de nuevo para terminar)');
    iniciarMonitoreoDeVolumen(micStream);
    cicloDeDictado(micStream);
  } catch {
    setStatus('no pude acceder al micrófono — revisá permisos de Windows', 'error');
  }
});

/* ---------- enviar ---------- */

async function enviar() {
  const text = editor.value.trim();
  if (!text) {
    setStatus('escribí algo primero');
    return;
  }
  sendBtn.disabled = true;
  const res = await window.smartprompts.send({ text, photos: fotos });
  sendBtn.disabled = false;
  if (res.ok) {
    editor.value = '';
    fotos = [];
    proximoNumero = 1;
    pintar();
    pintarStrip();
  }
}

sendBtn.addEventListener('click', enviar);

copyBtn.addEventListener('click', async () => {
  const text = editor.value.trim();
  if (!text) {
    setStatus('escribí algo primero');
    return;
  }
  copyBtn.disabled = true;
  setStatus('armando el prompt final…');
  const res = await window.smartprompts.copy({ text, photos: fotos });
  copyBtn.disabled = false;
  if (res.ok) {
    const aviso = res.fotosNoIncluidas
      ? ` (las ${res.fotosNoIncluidas} foto(s) citadas no se copian — usá "Enviar" para adjuntarlas)`
      : '';
    setStatus(`texto copiado al portapapeles ✓${aviso}`, 'ok');
  } else {
    setStatus(res.error || 'no se pudo copiar', 'error');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    enviar();
  } else if (e.key === 'Escape') {
    if (!helpPanel.hidden) {
      helpPanel.hidden = true;
    } else if (!settingsPanel.hidden) {
      settingsPanel.hidden = true;
    } else {
      window.smartprompts.hide(); // el borrador queda guardado en la ventana oculta
    }
  }
});

/* ---------- ayuda y ajustes ---------- */

$('helpBtn').addEventListener('click', () => {
  settingsPanel.hidden = true;
  helpPanel.hidden = !helpPanel.hidden;
});

$('settingsBtn').addEventListener('click', () => {
  helpPanel.hidden = true;
  settingsPanel.hidden = !settingsPanel.hidden;
});

$('saveBtn').addEventListener('click', async () => {
  const partial = {};
  const key = $('apiKeyInput').value.trim();
  const model = $('modelInput').value.trim();
  const hotkey = $('hotkeySelect').value;
  if (key) partial.apiKey = key;
  if (model) partial.model = model;
  if (hotkey) partial.hotkey = hotkey;
  const res = await window.smartprompts.saveSettings(partial);
  $('apiKeyInput').value = '';
  await cargarEstado();
  if (hotkey && res.hotkey && res.hotkey !== hotkey) {
    setStatus(`ese atajo ya estaba en uso — quedó activo ${NOMBRE_ATAJO(res.hotkey)}`, 'warn');
  } else {
    setStatus('ajustes guardados ✓', 'ok');
  }
});

$('testBtn').addEventListener('click', async () => {
  setStatus('probando conexión con Groq…');
  const res = await window.smartprompts.testConnection();
  if (res.ok) {
    $('modelsList').innerHTML = res.models
      .map((id) => `<option value="${id}"></option>`)
      .join('');
    setStatus(`conexión OK — ${res.models.length} modelos disponibles`, 'ok');
  } else {
    setStatus(res.error, 'error');
  }
});

$('quitBtn').addEventListener('click', () => window.smartprompts.quit());

/* ---------- arranque ---------- */

cargarEstado();
pintar();
editor.focus();
