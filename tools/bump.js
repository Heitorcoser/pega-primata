// Aumenta a versão do jogo (web/version.json). Rode antes de cada deploy:
//   node tools/bump.js          -> 1.0.0 => 1.0.1
// Jogadores com o jogo aberto (PC, navegador e APK) recebem o aviso e recarregam sozinhos.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'web', 'version.json');
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const p = j.version.split('.').map(Number);
p[2]++;
j.version = p.join('.');
fs.writeFileSync(file, JSON.stringify(j) + '\n');
console.log('nova versão do jogo:', j.version);
