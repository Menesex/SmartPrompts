// Motor de entrega: devuelve el foco a la app donde estaba el usuario y pega
// el prompt — primero el texto, después cada imagen citada, una por una, para
// que queden adjuntas al mismo mensaje. Validado en Gemini, Claude Code y DeepSeek.

const { clipboard, nativeImage } = require('electron');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

keyboard.config.autoDelayMs = 20;

// Si en tu máquina alguna app "se come" un pegado, subí estos tiempos.
const ESPERA = {
  foco: 400, // ms para que Windows devuelva el foco a la app anterior
  prePegado: 150, // ms entre copiar al portapapeles y simular Ctrl+V
  entreImagenes: 550, // ms para que la app procese cada adjunto
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pegar() {
  await keyboard.pressKey(Key.LeftControl, Key.V);
  await keyboard.releaseKey(Key.LeftControl, Key.V);
}

async function deliver({ deliveredText, photoPaths = [], hideWindow, onStatus = () => {} }) {
  hideWindow();
  await sleep(ESPERA.foco);

  onStatus('pegando el texto…');
  clipboard.writeText(deliveredText);
  await sleep(ESPERA.prePegado);
  await pegar();

  for (let i = 0; i < photoPaths.length; i++) {
    onStatus(`adjuntando imagen ${i + 1}/${photoPaths.length}…`);
    const img = nativeImage.createFromPath(photoPaths[i]);
    if (img.isEmpty()) continue;
    await sleep(ESPERA.entreImagenes);
    clipboard.writeImage(img);
    await sleep(ESPERA.prePegado);
    await pegar();
  }

  onStatus('listo ✓ — revisá el mensaje y envialo vos', 'ok');
}

module.exports = { deliver };
