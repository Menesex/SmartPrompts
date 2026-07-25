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

async function cargarEstado() {
  estado = await window.smartprompts.getState();
  $('hotkeyChip').textContent = estado.hotkey.replace('Space', 'Espacio');
  $('modelBadge').textContent = `groq · ${estado.model}`;
  micBtn.disabled = !estado.hasKey;
  micBtn.title = estado.hasKey
    ? 'Dictar por voz — se va escribiendo solo mientras hablás'
    : 'Para dictar, configurá tu API key de Groq en ⚙';
  $('modelInput').value = estado.model;
  $('apiKeyInput').placeholder = estado.hasKey
    ? '•••••• ya configurada — pegá una nueva solo para reemplazarla'
    : 'gsk_...';
}

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

const DURACION_SEGMENTO_MS = 4000;
const TAMANO_MINIMO_BYTES = 800; // segmentos casi vacíos (silencio al frenar) no se mandan a transcribir

let indiceSegmento = 0;
let proximoAInsertar = 0;
const resultadosPendientes = new Map();

function insertarResultadosEnOrden() {
  while (resultadosPendientes.has(proximoAInsertar)) {
    const texto = resultadosPendientes.get(proximoAInsertar);
    resultadosPendientes.delete(proximoAInsertar);
    proximoAInsertar++;
    if (texto) insertarEnCursor(texto + ' ');
  }
}

function grabarUnSegmento(stream) {
  return new Promise((resolve) => {
    const partes = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    rec.addEventListener('dataavailable', (e) => { if (e.data.size) partes.push(e.data); });
    rec.addEventListener('stop', () => resolve(new Blob(partes, { type: 'audio/webm' })));
    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, DURACION_SEGMENTO_MS);
  });
}

async function transcribirSegmento(blob, idx) {
  if (blob.size < TAMANO_MINIMO_BYTES) {
    resultadosPendientes.set(idx, '');
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
    const blob = await grabarUnSegmento(stream);
    transcribirSegmento(blob, idx); // sin await: ya arranca el próximo segmento en paralelo
  }
}

micBtn.addEventListener('click', async () => {
  if (grabando) {
    grabando = false;
    micBtn.classList.remove('recording');
    setStatus('terminando de transcribir el último segmento…');
    micStream.getTracks().forEach((t) => t.stop()); // esto también corta la grabación del segmento actual
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    grabando = true;
    indiceSegmento = 0;
    proximoAInsertar = 0;
    resultadosPendientes.clear();
    micBtn.classList.add('recording');
    setStatus('escuchando… el texto va apareciendo solo (clic de nuevo para terminar)');
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
  if (key) partial.apiKey = key;
  if (model) partial.model = model;
  await window.smartprompts.saveSettings(partial);
  $('apiKeyInput').value = '';
  await cargarEstado();
  setStatus('ajustes guardados ✓', 'ok');
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
