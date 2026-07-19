// Arma el texto final a entregar en la app destino:
// convierte {fotoN} en "(ver imagen X adjunta)" renumerando según qué fotos
// van adjuntas de verdad, y agrega al final la leyenda de convenciones.

const { parse, buildLegend, FOTO_RE } = require('./tagEngine');

function buildDeliveryText(text, sessionPhotos = []) {
  const parsed = parse(text);
  const disponibles = new Map(sessionPhotos.map((p) => [p.numero, p.path]));

  // Solo se adjuntan las fotos citadas en el texto, en orden de primera aparición.
  // Si el usuario borró {foto1} pero dejó {foto2}, la 2 pasa a ser "imagen 1 adjunta".
  const adjuntas = parsed.fotos.filter((n) => disponibles.has(n));
  const posicion = new Map(adjuntas.map((n, i) => [n, i + 1]));

  const cuerpo = text.replace(FOTO_RE, (m, d) => {
    const n = Number(d);
    return posicion.has(n) ? `(ver imagen ${posicion.get(n)} adjunta)` : '(imagen no disponible)';
  });

  const leyenda = buildLegend(parsed, adjuntas.length > 0);
  const deliveredText = leyenda.length
    ? `${cuerpo}\n\n— Convenciones de este prompt —\n${leyenda.map((l) => `• ${l}`).join('\n')}`
    : cuerpo;

  const photoPaths = adjuntas.map((n) => disponibles.get(n));
  return { deliveredText, photoPaths, adjuntas };
}

module.exports = { buildDeliveryText };
