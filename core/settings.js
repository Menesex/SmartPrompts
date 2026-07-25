// Ajustes del usuario, guardados como JSON en la carpeta de datos de la app
// (fuera del repo y fuera de OneDrive). La API key queda solo en esta máquina.

const fs = require('fs');
const path = require('path');

// llama-3.3-70b-versatile quedó deprecado en Groq (jun 2026); gpt-oss-120b es el reemplazo sugerido.
const DEFAULTS = {
  apiKey: '',
  model: 'openai/gpt-oss-120b',
  hotkey: 'Alt+Space',
  language: '', // '' = Whisper detecta el idioma solo; 'es'/'en' para forzarlo
};

function fileOf(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function load(userDataDir) {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(fileOf(userDataDir), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(userDataDir, settings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(fileOf(userDataDir), JSON.stringify(settings, null, 2));
}

module.exports = { load, save, DEFAULTS };
