// Motor de etiquetas [BRACKET] y citas {fotoN}. Lógica pura: no sabe nada de Electron.
// Si cambiás estas regex, actualizá también las copias de ui/palette.js (coloreado en vivo).

const TAG_RE = /\[(IMPORTANTE|ORDEN|CATEGORIA|RELACIONADO)(?:\s*:\s*([^\]]*))?\]/gi;
const FOTO_RE = /\{foto(\d+)\}/gi;

const LEYENDAS = {
  IMPORTANTE: '[IMPORTANTE] marca las partes de mayor prioridad',
  ORDEN: '[ORDEN:n] indica en qué orden leer o ejecutar cada parte',
  CATEGORIA: '[CATEGORIA:x] clasifica el tema de esa parte',
  RELACIONADO: '[RELACIONADO:...] vincula esa parte con otra sección o imagen del mensaje',
};

function parse(text) {
  const tags = [];
  for (const m of text.matchAll(TAG_RE)) {
    tags.push({ name: m[1].toUpperCase(), value: m[2] ? m[2].trim() : null, index: m.index });
  }
  const fotos = []; // números citados, en orden de primera aparición
  for (const m of text.matchAll(FOTO_RE)) {
    const n = Number(m[1]);
    if (!fotos.includes(n)) fotos.push(n);
  }
  return { tags, fotos };
}

// Nombres para guardar en la tabla tags: [CATEGORIA:trabajo] guarda "trabajo",
// el resto guarda el nombre de la etiqueta ("IMPORTANTE", "ORDEN"...).
function tagNames(text) {
  const { tags } = parse(text);
  const names = tags.map((t) => (t.name === 'CATEGORIA' && t.value ? t.value : t.name));
  return [...new Set(names)];
}

// Renglones que explican a la IA destino las convenciones usadas en este prompt.
function buildLegend({ tags }, conFotos) {
  const lines = [];
  for (const name of new Set(tags.map((t) => t.name))) {
    if (LEYENDAS[name]) lines.push(LEYENDAS[name]);
  }
  if (conFotos) {
    lines.push('"(ver imagen N adjunta)" se refiere a la N-ésima imagen adjunta a este mensaje, en orden');
  }
  return lines;
}

module.exports = { TAG_RE, FOTO_RE, parse, tagNames, buildLegend };
