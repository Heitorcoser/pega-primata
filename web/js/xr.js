// Entrada de VR (WebXR): cabeça e controles lidos direto do XRFrame (pose do quadro atual),
// em coordenadas do espaço de referência 'local-floor' = espaço local do rig.
import * as THREE from 'three';

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
  }

  async start(onEnd) {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.hadPose = false;
    try { if (session.updateTargetFrameRate && session.supportedFrameRates?.includes(90)) await session.updateTargetFrameRate(90); } catch { /* opcional */ }
    session.addEventListener('end', () => {
      this.session = null;
      onEnd?.();
    });
    return session;
  }

  end() { this.session?.end(); }

  // devolve true se houve pose válida neste quadro
  update(frame, loco) {
    if (!frame || !this.session) return false;
    const ref = this.renderer.xr.getReferenceSpace();
    const vp = frame.getViewerPose(ref);
    if (!vp) return false;
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
      const gp = src.gamepad;
      if (gp) {
        // giro rápido (snap turn) no analógico direito
        if (src.handedness === 'right') {
          const ax = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] || 0);
          if (Math.abs(ax) > 0.7 && this.snapReady) {
            loco.turn(ax > 0 ? -this.snapDegrees : this.snapDegrees);
            this.snapReady = false;
          } else if (Math.abs(ax) < 0.3) this.snapReady = true;
        }
        // botão B / Y (xr-standard: índice 5) troca de sala no painel
        if (gp.buttons[5]?.pressed) menu = true;
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

export async function vrSupported() {
  try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'))); }
  catch { return false; }
}

export const _unused = THREE; // mantém import (tree-shaking)
