// Andares da Estação Zero: tema, monstro e NPC de cada um.
// Compartilhado entre servidor e jogo.

export const SAMPLES_PER_FLOOR = 3;
export const ELEVATOR_COUNTDOWN = 10; // segundos depois que alguém entra no elevador aberto

export const FLOORS = [
  {
    name: 'Biologia',
    accent: 0x2fd6b0, // verde-água
    wallTint: 0xc9d6d4,
    fog: 0x050a0a,
    monster: {
      kind: 'babuino', label: 'Babuíno', count: 2, speed: 3.55, viewDist: 16, fov: 110,
      fur: 0x55503a, furTip: 0x8f8760, skin: 0x3a3230, muzzle: 0x2f2928, eyes: 0xffb22a, scale: 1.05, mane: 0x6d6648,
    },
    npc: {
      name: 'Dr. Bento', style: 'holo', color: 0x58c8ff,
      lines: [
        'Graças a Deus, alguém vivo! Os babuínos do teste escaparam.',
        'Ache as 3 amostras azuis pelo andar. Elas destrancam o elevador.',
        'Eles só enxergam o que está na frente deles. Use as paredes.',
        'Caixas com faixa amarela são altas: lá em cima eles não alcançam.',
        'Se te perderem de vista, vão até o último lugar em que te viram.',
      ],
    },
  },
  {
    name: 'Química',
    accent: 0xffa628, // âmbar
    wallTint: 0xd8cfc0,
    fog: 0x0a0704,
    monster: {
      kind: 'mandril', label: 'Mandril', count: 2, speed: 3.85, viewDist: 19, fov: 120,
      fur: 0x4c4a2a, furTip: 0x7d7a45, skin: 0x3a2d36, muzzle: 0xc8283a, cheek: 0x3a6fd8, eyes: 0xffe14a, scale: 1.1, mane: 0x6b6a3a,
    },
    npc: {
      name: 'ZÉ-7', style: 'robot', color: 0xffb347,
      lines: [
        'BIP. ZÉ-7, robô de manutenção. Bem-vindos ao andar de Química.',
        'Os mandris daqui são mais rápidos e enxergam mais longe. BIP.',
        'Amostras detectadas: 3. Localização: espalhadas. Boa sorte. BIP.',
        'Dica: mezaninos com escada são ótimos para despistar.',
        'O elevador de carga fica do outro lado do labirinto.',
      ],
    },
  },
  {
    name: 'Contenção',
    accent: 0xff3b30, // vermelho
    wallTint: 0xc4bcbc,
    fog: 0x0a0405,
    monster: {
      kind: 'alfa', label: 'Babuíno-alfa', count: 3, speed: 4.05, viewDist: 18, fov: 115,
      fur: 0xa8a294, furTip: 0xdcd6c6, skin: 0x5e4a48, muzzle: 0x6a5452, eyes: 0xff2a1a, scale: 1.25, mane: 0xc8c2b2,
    },
    npc: {
      name: 'Dra. Íris', style: 'holo', color: 0xff6b6b,
      lines: [
        'Vocês chegaram à Contenção... os alfa nasceram aqui.',
        'São três. Maiores, mais rápidos. Não corram em linha reta.',
        'Pegue as 3 últimas amostras e saia pelo elevador. É o fim.',
        'Eles sentem quem chega perto, mesmo por trás. Mantenha distância.',
        'Se conseguirem sair... contem para todo mundo o que viram aqui.',
      ],
    },
  },
];

// texto curto do objetivo para o quadro/HUD
export function objectiveText(floor, collected, exitOpen) {
  if (floor >= FLOORS.length) return 'Vocês escaparam da Estação Zero!';
  if (exitOpen) return 'Elevador de saída ABERTO! Entrem todos para subir.';
  return `Encontre as amostras: ${collected}/${SAMPLES_PER_FLOOR}`;
}

// semente da sala -> semente do andar
export const floorSeed = (roomSeed, floor) => (roomSeed * 31 + floor * 1013 + 7) >>> 0;
