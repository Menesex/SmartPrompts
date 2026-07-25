// Proceso principal de SmartPrompts: ventanas, atajo global, bandeja, IPC.
// La lógica de negocio vive en /core y el historial en /data.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, session, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const ajustes = require('./core/settings');
const groq = require('./core/groqClient');
const { deliver } = require('./core/delivery');
const { buildDeliveryText } = require('./core/promptBuilder');
const { tagNames } = require('./core/tagEngine');
const { init: initDb } = require('./data/db');

const ScreenshotsMod = require('electron-screenshots');
const Screenshots = ScreenshotsMod.default || ScreenshotsMod;

// Cuadrado violeta de marca, embebido para no depender de archivos sueltos.
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAADwCAIAAACxN37FAAACl0lEQVR4nO3SUQkAIBTAwFfSpgYzgiUEYRxcgH1s9jqQMd8L4CFDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphiblApOo8vYkDQFdAAAAAElFTkSuQmCC';

const ANCHO = 680;
const ALTO = 580; // el editor de texto necesita respirar mientras se dicta
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opciones que se ofrecen en Ajustes. La primera que logre registrarse gana;
// si el usuario no eligió ninguna todavía, se prueban en este mismo orden.
const ATAJOS_DISPONIBLES = ['Alt+Space', 'Ctrl+Alt+Space', 'Ctrl+Shift+Space', 'Alt+Q', 'Ctrl+Alt+P'];

let win = null;
let tray = null;
let screenshots = null;
let db = null;
let config = null;
let atajoActivo = null;
let capturando = false;
let entregando = false;
let fijada = false; // ventana "pineada": no se oculta sola al perder el foco

// Una sola instancia: si abren otra, se muestra la palette de la existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => mostrarPalette());
}

const status = (msg, kind = '') => win && win.webContents.send('status', msg, kind);

function crearVentana() {
  win = new BrowserWindow({
    width: ANCHO,
    height: ALTO,
    minWidth: 460,
    minHeight: 340,
    show: false,
    frame: false,
    transparent: true,
    resizable: true, // se puede estirar de los bordes aunque no tenga marco
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: nativeImage.createFromDataURL('data:image/png;base64,' + ICON_B64),
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
    },
  });
  win.loadFile(path.join('ui', 'palette.html'));

  // Como toda command palette: se esconde al perder el foco (el borrador no se pierde) —
  // salvo que el usuario la haya "fijado" con el botón 📌.
  win.on('blur', () => {
    if (!capturando && !entregando && !fijada) win.hide();
  });
}

function mostrarPalette() {
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  win.setPosition(Math.round(area.x + (area.width - ANCHO) / 2), area.y + 90);
  win.show();
  win.focus();
}

function togglePalette() {
  if (win.isVisible()) win.hide();
  else mostrarPalette();
}

function capturarRegion() {
  return new Promise((resolve) => {
    const onOk = (_e, buffer) => { limpiar(); resolve(buffer); };
    const onCancel = () => { limpiar(); resolve(null); };
    const limpiar = () => {
      screenshots.off('ok', onOk);
      screenshots.off('cancel', onCancel);
    };
    screenshots.on('ok', onOk);
    screenshots.on('cancel', onCancel);
    screenshots.startCapture();
  });
}

// Prueba, en orden, el atajo preferido y la lista de respaldo. Actualiza el
// menú de la bandeja y devuelve el que finalmente quedó activo (puede no ser
// el pedido, si ya lo tiene tomado otro programa).
function registrarAtajo(preferido) {
  globalShortcut.unregisterAll();
  atajoActivo = null;
  const candidatos = [preferido, ...ATAJOS_DISPONIBLES.filter((a) => a !== preferido)];
  for (const atajo of candidatos) {
    if (globalShortcut.register(atajo, togglePalette)) {
      atajoActivo = atajo;
      break;
    }
  }
  if (tray) {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Abrir / ocultar (${atajoActivo || 'sin atajo'})`, click: togglePalette },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ]));
  }
  return atajoActivo;
}

/* ---------- IPC ---------- */

ipcMain.handle('get-state', () => ({
  hotkey: atajoActivo || 'sin atajo',
  model: config.model,
  hasKey: Boolean(config.apiKey),
  atajosDisponibles: ATAJOS_DISPONIBLES,
  fijada,
}));

ipcMain.handle('save-settings', (_e, partial = {}) => {
  if (partial.apiKey) config.apiKey = partial.apiKey;
  if (partial.model) config.model = partial.model;
  let hotkeyAplicado = atajoActivo;
  if (partial.hotkey && partial.hotkey !== config.hotkey) {
    config.hotkey = partial.hotkey;
    hotkeyAplicado = registrarAtajo(partial.hotkey);
  }
  ajustes.save(app.getPath('userData'), config);
  return { ok: true, hotkey: hotkeyAplicado };
});

ipcMain.handle('toggle-pin', () => {
  fijada = !fijada;
  return { fijada };
});

ipcMain.handle('test-connection', async () => {
  try {
    if (!config.apiKey) return { ok: false, error: 'primero pegá tu API key y guardá' };
    const models = await groq.listModels(config);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('transcribe', async (_e, arrayBuffer) => {
  try {
    if (!config.apiKey) return { ok: false, error: 'configurá tu API key de Groq en ⚙' };
    const text = await groq.transcribe(Buffer.from(arrayBuffer), config);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('capture', async () => {
  capturando = true;
  win.hide(); // así se ve la pantalla que estaba debajo, que es lo que se quiere capturar
  await sleep(300);
  try {
    const buffer = await capturarRegion();
    if (!buffer) return { canceled: true };
    const dir = path.join(app.getPath('userData'), 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `captura-${Date.now()}.png`);
    fs.writeFileSync(file, buffer);
    return { path: file };
  } catch (err) {
    return { canceled: true, error: err.message };
  } finally {
    capturando = false;
    mostrarPalette();
  }
});

async function prepararEntrega({ text, photos }) {
  let refined = null;
  if (config.apiKey) {
    status('refinando con Groq…');
    try {
      refined = await groq.refinePrompt(text, config);
    } catch (err) {
      status(`Groq falló (${err.message}) — sigo con el texto sin refinar`, 'warn');
    }
  }
  const base = refined || text;
  const { deliveredText, photoPaths } = buildDeliveryText(base, photos);
  return { rawText: text, refined, base, deliveredText, photoPaths };
}

ipcMain.handle('send', async (_e, { text, photos = [] }) => {
  entregando = true;
  try {
    const { rawText, refined, base, deliveredText, photoPaths } = await prepararEntrega({ text, photos });

    await deliver({
      deliveredText,
      photoPaths,
      hideWindow: () => win.hide(),
      onStatus: status,
    });

    if (db) {
      db.saveDelivery({ rawText, refinedText: refined, deliveredText, photos, tagNames: tagNames(base) });
    }
    return { ok: true };
  } catch (err) {
    status(`error al entregar: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  } finally {
    entregando = false;
  }
});

// Plan B: arma el mismo texto final pero SOLO lo copia al portapapeles —
// no toca el foco de ninguna ventana ni simula ningún pegado. Pensado para
// probar/leer el resultado sin efectos secundarios sobre lo que tengas abierto.
ipcMain.handle('copy', async (_e, { text, photos = [] }) => {
  try {
    const { deliveredText, photoPaths } = await prepararEntrega({ text, photos });
    clipboard.writeText(deliveredText);
    return { ok: true, fotosNoIncluidas: photoPaths.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('hide', () => win.hide());
ipcMain.handle('quit', () => app.quit());

/* ---------- arranque ---------- */

app.whenReady().then(() => {
  app.setAppUserModelId('com.menesex.smartprompts');
  config = ajustes.load(app.getPath('userData'));
  db = initDb(app.getPath('userData'));

  // Permitir el micrófono (dictado por voz) sin diálogo del sistema Chromium.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  crearVentana();
  screenshots = new Screenshots({ singleWindow: true });

  const icon = nativeImage.createFromDataURL('data:image/png;base64,' + ICON_B64);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('SmartPrompts');
  tray.on('click', togglePalette);

  registrarAtajo(config.hotkey);
  if (!atajoActivo) console.error('[SmartPrompts] no pude registrar ningún atajo global');

  console.log(`[SmartPrompts] listo — atajo global: ${atajoActivo}`);
  mostrarPalette();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Sin ventanas visibles la app sigue viva en la bandeja; solo se cierra desde "Salir".
app.on('window-all-closed', (e) => e.preventDefault());
