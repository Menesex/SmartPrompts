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
const settingsPanel = $('settings');

let fotos = []; // { numero, path } de la sesión actual
let proximoNumero = 1;
let grabando = false;
let mediaRecorder = null;
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
  micBtn.title = estado.hasKey ? 'Dictar por voz' : 'Para dictar, configurá tu API key de Groq en ⚙';
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

/* ---------- dictado por voz ---------- */

micBtn.addEventListener('click', async () => {
  if (grabando) {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.addEventListener('dataavailable', (e) => chunks.push(e.data));
    mediaRecorder.addEventListener('stop', async () => {
      grabando = false;
      micBtn.classList.remove('recording');
      stream.getTracks().forEach((t) => t.stop());
      setStatus('transcribiendo…');
      const buffer = await new Blob(chunks).arrayBuffer();
      const res = await window.smartprompts.transcribe(buffer);
      if (res.ok && res.text) {
        insertarEnCursor(res.text + ' ');
        setStatus('dictado transcripto ✓', 'ok');
      } else {
        setStatus(res.error || 'no se entendió el audio', 'error');
      }
    });
    mediaRecorder.start();
    grabando = true;
    micBtn.classList.add('recording');
    setStatus('grabando… (clic de nuevo para terminar)');
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    enviar();
  } else if (e.key === 'Escape') {
    if (!settingsPanel.hidden) {
      settingsPanel.hidden = true;
    } else {
      window.smartprompts.hide(); // el borrador queda guardado en la ventana oculta
    }
  }
});

/* ---------- ajustes ---------- */

$('settingsBtn').addEventListener('click', () => {
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
