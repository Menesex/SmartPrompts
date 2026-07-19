const { app, BrowserWindow, globalShortcut, clipboard, nativeImage } = require('electron');
const path = require('path');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const HOTKEY = 'Alt+Shift+V';
const TEST_IMAGE_PATH = path.join(__dirname, 'test-assets', 'foto-prueba.png');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 360,
    title: 'SmartPrompts — spike de pegado de imagen',
  });
  win.loadFile('index.html');
}

async function pasteTestImage() {
  console.log('[SmartPrompts spike] Atajo detectado, copiando imagen de prueba al portapapeles...');

  const image = nativeImage.createFromPath(TEST_IMAGE_PATH);
  if (image.isEmpty()) {
    console.error('[SmartPrompts spike] No se pudo cargar la imagen de prueba en', TEST_IMAGE_PATH);
    return;
  }
  clipboard.writeImage(image);

  // pequeña pausa para que el portapapeles quede listo antes del paste simulado
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    await keyboard.pressKey(Key.LeftControl, Key.V);
    await keyboard.releaseKey(Key.LeftControl, Key.V);
    console.log('[SmartPrompts spike] Ctrl+V simulado. Revisá la ventana donde tenías el foco antes de apretar el atajo.');
  } catch (err) {
    console.error('[SmartPrompts spike] Error simulando el paste:', err);
  }
}

app.whenReady().then(() => {
  createWindow();

  const registered = globalShortcut.register(HOTKEY, pasteTestImage);
  if (!registered) {
    console.error(`[SmartPrompts spike] No se pudo registrar el atajo ${HOTKEY} (¿ya lo usa otra app?)`);
  } else {
    console.log(`[SmartPrompts spike] Listo. Enfocá el chat de destino y apretá ${HOTKEY}.`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
