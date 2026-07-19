// Genera una imagen de prueba (cuadrado violeta, el color de marca de SmartPrompts)
// sin depender de librerías externas de imágenes — solo para el spike de pegado.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 240;
const HEIGHT = 240;
const [R, G, B] = [0xb4, 0x55, 0xf0];

const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // profundidad de bits
ihdr[9] = 2; // tipo de color: RGB

const rowLength = 1 + WIDTH * 3;
const raw = Buffer.alloc(rowLength * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const rowStart = y * rowLength;
  raw[rowStart] = 0; // sin filtro
  for (let x = 0; x < WIDTH; x++) {
    const px = rowStart + 1 + x * 3;
    raw[px] = R;
    raw[px + 1] = G;
    raw[px + 2] = B;
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, 'test-assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'foto-prueba.png');
fs.writeFileSync(outPath, png);
console.log('Imagen de prueba generada en', outPath);
