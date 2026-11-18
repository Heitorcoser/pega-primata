// Detecção de VR no PC.
//  • No navegador (Chrome/Edge no Windows): o WebXR usa o runtime OpenXR do PC (SteamVR,
//    Quest Link/Air Link, Virtual Desktop, WMR). Checamos ao abrir, quando um headset é
//    conectado (evento 'devicechange') e quando o menu reabre.
//    Não fazemos verificação periódica: em alguns PCs, cada checagem pode abrir o SteamVR.
//  • No EXE (Electron): o Electron padrão não tem OpenXR, então o app detecta o headset
//    pelo sistema (runtime OpenXR + SteamVR/Link rodando) e abre o jogo numa janela do
//    Chrome/Edge, onde o VR funciona.
import { vrSupported } from './xr.js';

const $ = (id) => document.getElementById(id);

export function setupPcVr({ startWebXR, getMode, getJoin }) {
  const isExe = !!window.desktopVR;
  const state = { webxr: false, exe: null };

  function render() {
    const box = $('vr-detect'), txt = $('vr-detect-text'), btn = $('vr-detect-btn'), hud = $('hud-vr');
    let text = '', button = '', hudText = '';
    if (isExe && state.exe) {
      const s = state.exe;
      if (s.headsetActive) {
        text = `🥽 Headset detectado (${s.apps.join(', ')}). O VR do PC abre numa janela do ${s.browser || 'navegador'}.`;
        button = 'Jogar em VR';
        hudText = '🥽 Headset detectado — aperte V para jogar em VR';
      } else if (s.runtime) {
        text = `VR instalado (${s.runtime}). Ligue o headset e abra o ${s.runtime} para jogar em VR.`;
      }
    } else if (state.webxr) {
      text = '🥽 Headset VR detectado neste PC.';
      hudText = '🥽 Headset detectado — aperte V para entrar no VR';
    }
    box.classList.toggle('hidden', !text);
    txt.textContent = text;
    btn.classList.toggle('hidden', !button);
    btn.textContent = button;
    hud.classList.toggle('hidden', !hudText || getMode() !== 'desktop');
    hud.textContent = hudText;
    $('play-vr').classList.toggle('hidden', !state.webxr);
    if (state.webxr) $('vr-hint').classList.add('hidden');
  }

  async function refresh() {
    if (isExe) {
      try { state.exe = await window.desktopVR.status(); } catch { state.exe = null; }
    } else {
      state.webxr = await vrSupported();
    }
    render();
  }

  async function goVR() {
    if (isExe) {
      if (!state.exe?.headsetActive) return false;
      const r = await window.desktopVR.open(getJoin());
      if (!r?.ok) alert(r?.reason || 'Não foi possível abrir o VR.');
      return true;
    }
    if (state.webxr) { startWebXR(); return true; }
    return false;
  }

  $('vr-detect-btn').onclick = goVR;
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && getMode() === 'desktop') {
      document.exitPointerLock?.();
      goVR();
    }
  });

  if (isExe) {
    setInterval(refresh, 4000); // checagem do sistema é barata e não abre nada
  } else {
    navigator.xr?.addEventListener?.('devicechange', refresh);
  }
  refresh();
  return { refresh, render };
}

// nome amigável do controle a partir do perfil WebXR (inputSource.profiles[0])
export function controllerName(profile = '') {
  const p = profile.toLowerCase();
  if (p.includes('oculus') || p.includes('meta-quest')) return 'Meta Touch';
  if (p.includes('valve-index')) return 'Valve Index';
  if (p.includes('htc-vive-focus')) return 'Vive Focus';
  if (p.includes('htc-vive-cosmos')) return 'Vive Cosmos';
  if (p.includes('htc-vive')) return 'HTC Vive';
  if (p.includes('hp-mixed-reality')) return 'HP Reverb';
  if (p.includes('microsoft-mixed-reality') || p.includes('samsung-odyssey')) return 'Windows Mixed Reality';
  if (p.includes('pico') || p.includes('bytedance')) return 'PICO';
  if (!p) return '';
  return 'Genérico (' + profile + ')';
}
