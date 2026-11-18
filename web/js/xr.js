// Entrada de VR (WebXR): cabeça e controles lidos direto do XRFrame (pose do quadro atual),
// em coordenadas do espaço de referência 'local-floor' = espaço local do rig.
import * as THREE from 'three';
import { diag } from './diag.js';

export class XRInput {
  constructor(renderer, player) {
    this.renderer = renderer;
    this.player = player;
    this.session = null;
    this.sources = { left: null, right: null };
    this.snapReady = true;
    this.snapDegrees = 45;
    this.hadPose = false;
    this.menuPressed = false;
    this._prevMenu = false;
    this.profiles = { left: '', right: '' }; // modelo do controle (ex.: 'valve-index')
  }

  async start(onEnd) {
    // modo compatível = igual ao teste mínimo que funcionou no PC VR (sem recursos extras)
    const compat = !!this.compatMode;
    diag.step('requestSession', { compat });
    // só 'local-floor' (o jogo não usa 'bounded-floor'; com SteamVR ele pode segurar os quadros)
    const session = await navigator.xr.requestSession('immersive-vr', compat ? {} : { optionalFeatures: ['local-floor'] });
    diag.step('session-ok', {
      features: [...(session.enabledFeatures || [])].join(','),
      rates: session.supportedFrameRates ? [...session.supportedFrameRates].join(',') : '',
      blend: session.environmentBlendMode,
    });
    session.addEventListener('end', () => diag.step('session-end', { frames: this.frames }));
    // tenta 'local-floor'; se o runtime do PC não tiver, usa 'local' (senão o setSession falha)
    let refType = compat ? 'local' : 'local-floor';
    if (!compat) { try { await session.requestReferenceSpace('local-floor'); } catch { refType = 'local'; } }
    this.renderer.xr.setReferenceSpaceType(refType);
    const layersApi = session.renderState.layers !== undefined;
    forceBaseLayer(session);
    diag.step('setSession', { refType, layersApi, forced: session.renderState.layers === undefined });
    await this.renderer.xr.setSession(session);
    diag.step('setSession-ok');
    if (refType === 'local') {
      // 'local' começa na altura dos olhos: desloca a origem 1,6 m para baixo (vira "chão")
      const base = this.renderer.xr.getReferenceSpace();
      this.renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: -1.6, z: 0 })));
    }
    this.session = session;
    this.hadPose = false;
    this.frames = 0;
    this.nullPoses = 0;
    try { if (session.updateTargetFrameRate && session.supportedFrameRates?.includes(90)) await session.updateTargetFrameRate(90); } catch { /* opcional */ }
    // batimento: se parar de chegar, a página travou; se chegar com frames=0, o runtime não manda quadros
    this.loopCalls = 0;
    session.addEventListener('visibilitychange', () => diag.step('xr-visibility', { v: session.visibilityState }));
    const beat = setInterval(() => {
      if (!this.session) { clearInterval(beat); return; }
      diag.step('alive', {
        frames: this.frames, nullPoses: this.nullPoses, loopCalls: this.loopCalls,
        xrVis: session.visibilityState, docVis: document.visibilityState, focus: document.hasFocus(),
        presenting: this.renderer.xr.isPresenting,
      });
    }, 2000);
    // contador "cru" de quadros entregues pelo navegador, independente do laço do jogo:
    // separa "o navegador não manda quadros" de "o laço do jogo parou"
    let open = true;
    this.rawFrames = 0;
    const raw = () => { this.rawFrames++; if (open) session.requestAnimationFrame(raw); };
    session.requestAnimationFrame(raw);
    // vigia: sem quadros do jogo em 5 s => sai do VR; o próximo clique usa o modo compatível
    setTimeout(() => {
      if (!open || this.frames > 0) return;
      diag.step('watchdog-no-frames', { raw: this.rawFrames, loopCalls: this.loopCalls, compat });
      if (!compat) this.compatMode = true;
      this.onNoFrames?.(compat);
      session.end();
    }, 5000);
    session.addEventListener('end', () => {
      open = false;
      clearInterval(beat);
      this.session = null;
      onEnd?.();
    });
    return session;
  }

  end() { this.session?.end(); }

  // devolve true se houve pose válida neste quadro
  update(frame, loco) {
    this.loopCalls = (this.loopCalls || 0) + 1;
    if (!frame || !this.session) return false;
    const ref = this.renderer.xr.getReferenceSpace();
    this.frames++;
    if (this.frames === 1) diag.step('first-frame');
    const vp = frame.getViewerPose(ref);
    if (!vp) { this.nullPoses++; return false; }
    if (!this.hadPose) diag.step('first-pose', { frames: this.frames });
    const p = this.player;
    const t = vp.transform;
    p.headLocal.set(t.position.x, t.position.y, t.position.z);
    p.headLocalQuat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);

    this.sources.left = this.sources.right = null;
    let menu = false;
    for (const src of this.session.inputSources) {
      if (!src.gripSpace || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      this.sources[src.handedness] = src;
      const pose = frame.getPose(src.gripSpace, ref);
      if (!pose) continue;
      const i = src.handedness === 'left' ? 0 : 1;
      const pt = pose.transform;
      p.handLocal[i].set(pt.position.x, pt.position.y, pt.position.z);
      p.handLocalQuat[i].set(pt.orientation.x, pt.orientation.y, pt.orientation.z, pt.orientation.w);
      if (src.profiles?.length) this.profiles[src.handedness] = src.profiles[0];
      const gp = src.gamepad;
      if (gp) {
        // giro rápido (snap turn) no direito: analógico (Touch/Index/WMR) ou
        // touchpad pressionado nas laterais (HTC Vive — só tocar não gira)
        if (src.handedness === 'right') {
          const stick = gp.axes[2] || 0;
          const pad = gp.buttons[2]?.pressed ? (gp.axes[0] || 0) : 0;
          const ax = Math.abs(stick) >= Math.abs(pad) ? stick : pad;
          if (Math.abs(ax) > 0.7 && this.snapReady) {
            loco.turn(ax > 0 ? -this.snapDegrees : this.snapDegrees);
            this.snapReady = false;
          } else if (Math.abs(ax) < 0.3) this.snapReady = true;
        }
        // renascer: B/Y (xr-standard índice 5) ou clique do analógico/touchpad esquerdo
        // (controles sem B/Y, como o Vive)
        if (gp.buttons[5]?.pressed) menu = true;
        if (src.handedness === 'left' && gp.buttons[3]?.pressed) menu = true;
      }
    }
    this.menuPressed = menu && !this._prevMenu;
    this._prevMenu = menu;
    this.hadPose = true;
    return true;
  }

  haptic(handedness, intensity = 0.5, ms = 40) {
    const src = this.sources[handedness];
    const act = src?.gamepad?.hapticActuators?.[0];
    try {
      if (act?.pulse) act.pulse(intensity, ms);
      else src?.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch { /* sem vibração */ }
  }
}

// O three.js usa a camada de projeção (WebXR Layers) sempre que o navegador tem essa API,
// mesmo sem o recurso 'layers' ter sido pedido. No Chrome/Edge do PC (SteamVR/Link) a sessão
// então nunca recebe quadros e o SteamVR acusa "não está respondendo". Aqui escondemos
// renderState.layers para o three.js usar a XRWebGLLayer clássica — o caminho que funciona
// em qualquer navegador com WebXR (Quest, PC, PICO).
function forceBaseLayer(session) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'renderState')
    || Object.getOwnPropertyDescriptor(XRSession.prototype, 'renderState');
  if (!desc?.get) return;
  Object.defineProperty(session, 'renderState', {
    configurable: true,
    get() {
      const rs = desc.get.call(session);
      return new Proxy(rs, {
        get(target, key) {
          if (key === 'layers') return undefined;
          const v = Reflect.get(target, key, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  });
}

export async function vrSupported() {
  try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'))); }
  catch { return false; }
}

export const _unused = THREE; // mantém import (tree-shaking)
