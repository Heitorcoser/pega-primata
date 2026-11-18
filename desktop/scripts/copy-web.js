// Copia a pasta ../web para ./offline (cópia embutida no EXE, usada sem internet).
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', '..', 'web');
const dst = path.resolve(__dirname, '..', 'offline');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('web copiado para', dst);
