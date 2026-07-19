// Historial local en SQLite usando node:sqlite (viene incluido en el runtime,
// sin dependencias nativas que compilar). El archivo .db vive en la carpeta de
// datos de la app, no en el repo. Si SQLite fallara, la app sigue funcionando
// sin historial — nunca bloquea una entrega.

const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // runtime sin node:sqlite — seguimos sin historial
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text TEXT NOT NULL,
  refined_text TEXT,
  delivered_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER REFERENCES prompts(id),
  numero INTEGER,
  file_path TEXT NOT NULL,
  parent_photo_id INTEGER REFERENCES photos(id), -- "versión nueva de" (galería, Fase 2)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_tags (
  prompt_id INTEGER NOT NULL REFERENCES prompts(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (prompt_id, tag_id)
);
CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (photo_id, tag_id)
);
`;

function init(userDataDir) {
  if (!DatabaseSync) return null;
  try {
    const db = new DatabaseSync(path.join(userDataDir, 'smartprompts.db'));
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);

    return {
      saveDelivery({ rawText, refinedText, deliveredText, photos = [], tagNames = [] }) {
        try {
          const r = db
            .prepare('INSERT INTO prompts (raw_text, refined_text, delivered_text) VALUES (?, ?, ?)')
            .run(rawText, refinedText, deliveredText);
          const promptId = Number(r.lastInsertRowid);

          const insFoto = db.prepare('INSERT INTO photos (prompt_id, numero, file_path) VALUES (?, ?, ?)');
          for (const p of photos) insFoto.run(promptId, p.numero, p.path);

          const upTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
          const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
          const link = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)');
          for (const name of tagNames) {
            upTag.run(name);
            const t = getTag.get(name);
            if (t) link.run(promptId, Number(t.id));
          }
        } catch (err) {
          console.error('[SmartPrompts] no se pudo guardar el historial:', err.message);
        }
      },
    };
  } catch (err) {
    console.error('[SmartPrompts] SQLite no disponible:', err.message);
    return null;
  }
}

module.exports = { init };
