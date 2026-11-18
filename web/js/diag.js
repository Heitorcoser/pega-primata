// Diagnóstico da entrada no VR: registra cada etapa e manda na hora para o servidor
// (aparece nos logs do Render). Se a página travar, as etapas anteriores já chegaram,
// mostrando exatamente onde travou.
const sid = Math.random().toString(36).slice(2, 8);
let t0 = 0;
let sent = 0;

function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { return '?'; }
}

function post(entry) {
  if (sent++ > 80 || location.protocol === 'file:') return;
  const body = JSON.stringify(entry);
  try {
    if (!navigator.sendBeacon?.('diag', new Blob([body], { type: 'application/json' }))) {
      fetch('diag', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* sem rede */ }
}

export const diag = {
  start(gl) {
    t0 = performance.now();
    sent = 0;
    post({
      sid, step: 'click', ms: 0,
      ua: navigator.userAgent.slice(0, 160),
      client: new URLSearchParams(location.search).get('client') || 'web',
      gpu: gpuName(gl), xrCompatible: gl.getContextAttributes()?.xrCompatible,
    });
  },
  step(step, data) {
    if (!t0) return;
    post({ sid, step, ms: Math.round(performance.now() - t0), ...(data || {}) });
  },
};

addEventListener('error', (e) => diag.step('error', { msg: String(e.message).slice(0, 200) }));
addEventListener('unhandledrejection', (e) => diag.step('rejection', { msg: String(e.reason?.message || e.reason).slice(0, 200) }));
