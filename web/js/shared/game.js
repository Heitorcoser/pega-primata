// Regras de uma partida da Estação Zero (compartilhado: servidor e jogo solo).
// Progresso: amostras -> elevador de saída abre -> alguém entra -> contagem -> próximo andar.
import { generateFloor } from './station.js';
import { MonsterSim } from './monsterai.js';
import { FLOORS, SAMPLES_PER_FLOOR, ELEVATOR_COUNTDOWN, floorSeed } from './levels.js';

export const randomSeed = () => Math.floor(Math.random() * 2147483647);

export class FloorGame {
  constructor(seed = randomSeed(), floor = 0) {
    this.seed = seed;
    this.levelId = 0;
    this.setFloor(floor);
  }

  setFloor(f) {
    this.floor = f;
    this.won = f >= FLOORS.length;
    const fi = Math.min(f, FLOORS.length - 1);
    this.st = generateFloor(floorSeed(this.seed, fi));
    this.variant = FLOORS[fi].monster;
    this.sim = new MonsterSim(this.st, this.variant, floorSeed(this.seed, fi) + 1);
    if (!this.won) this.sim.spawn(this.variant.count);
    this.collected = new Set();
    this.exitOpen = false;
    this.countdown = -1;
    this.winT = 0;
    this.levelId++;
  }

  // jogador encostou a mão numa amostra
  pick(sampleId, hand) {
    if (this.won) return false;
    const s = this.st.samples.find((x) => x.id === sampleId);
    if (!s || this.collected.has(sampleId)) return false;
    if (hand && Math.hypot(hand.x - s.x, hand.y - s.y, hand.z - s.z) > 1.2) return false; // folga p/ latência
    this.collected.add(sampleId);
    if (this.collected.size >= SAMPLES_PER_FLOOR) this.exitOpen = true;
    return true;
  }

  // players: [{ id, x, y, z }] (cabeça), só os vivos
  update(dt, players) {
    const events = [];
    if (this.won) {
      this.winT += dt;
      if (this.winT > 14) { // nova partida, novo labirinto
        this.seed = randomSeed();
        this.setFloor(0);
        events.push({ type: 'level' });
      }
      return events;
    }
    events.push(...this.sim.update(dt, players));
    if (this.exitOpen) {
      if (this.countdown < 0 && players.some((p) => this.st.inExitElevator(p.x, p.z))) {
        this.countdown = ELEVATOR_COUNTDOWN;
        events.push({ type: 'progress' });
      }
      if (this.countdown >= 0) {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        if (Math.ceil(this.countdown) !== before) events.push({ type: 'tick', left: Math.max(0, Math.ceil(this.countdown)) });
        if (this.countdown <= 0) {
          this.setFloor(this.floor + 1);
          events.push({ type: 'level' });
        }
      }
    }
    return events;
  }

  progress() {
    return {
      seed: this.seed, floor: this.floor, levelId: this.levelId, won: this.won,
      collected: [...this.collected], exitOpen: this.exitOpen,
      countdown: this.countdown >= 0 ? Math.ceil(this.countdown) : -1,
    };
  }
}
