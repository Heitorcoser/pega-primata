// Detecção de VR de PC no Windows + abertura do jogo num navegador com WebXR.
//
// Por que abrir no navegador? O Electron padrão é compilado sem OpenXR, então o WebXR
// dele não enxerga headsets de PC (electron/electron#35011). Chrome e Edge no Windows
// têm OpenXR e funcionam com SteamVR, Quest Link/Air Link, Virtual Desktop e WMR.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// processos que indicam um headset em uso
const VR_APPS = {
  'vrserver.exe': 'SteamVR',
  'vrmonitor.exe': 'SteamVR',
  'ovrserver_x64.exe': 'Meta Quest Link',
  'virtualdesktop.streamer.exe': 'Virtual Desktop',
  'mixedrealityportal.exe': 'Windows Mixed Reality',
  'alvr_dashboard.exe': 'ALVR',
  'pico connect.exe': 'PICO Connect',
  'streaming_assistant.exe': 'PICO Streaming',
};

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 4000 }, (err, out) => resolve(err ? '' : String(out)));
  });
}

function runtimeLabel(jsonPath) {
  const p = jsonPath.toLowerCase();
  if (p.includes('steamvr') || p.includes('steamxr')) return 'SteamVR';
  if (p.includes('oculus')) return 'Meta Quest Link';
  if (p.includes('mixedreality')) return 'Windows Mixed Reality';
  if (p.includes('virtualdesktop')) return 'Virtual Desktop';
  if (p.includes('pico')) return 'PICO';
  if (p.includes('varjo')) return 'Varjo';
  return path.basename(jsonPath, '.json');
}

async function activeRuntime() {
  for (const hive of ['HKLM', 'HKCU']) {
    const out = await run('reg', ['query', `${hive}\\SOFTWARE\\Khronos\\OpenXR\\1`, '/v', 'ActiveRuntime']);
    const m = out.match(/ActiveRuntime\s+REG_\w+\s+(.+)/);
    if (m) return { path: m[1].trim(), label: runtimeLabel(m[1].trim()) };
  }
  return null;
}

async function runningVrApps() {
  const out = await run('tasklist', ['/FO', 'CSV', '/NH']);
  const found = new Set();
  for (const line of out.split(/\r?\n/)) {
    const name = line.split('","')[0].replace(/^"/, '').toLowerCase();
    if (VR_APPS[name]) found.add(VR_APPS[name]);
  }
  return [...found];
}

function findBrowser() {
  const env = process.env;
  const candidates = [
    [env['ProgramFiles'], 'Google\\Chrome\\Application\\chrome.exe', 'Chrome'],
    [env['ProgramFiles(x86)'], 'Google\\Chrome\\Application\\chrome.exe', 'Chrome'],
    [env['LOCALAPPDATA'], 'Google\\Chrome\\Application\\chrome.exe', 'Chrome'],
    [env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe', 'Edge'],
    [env['ProgramFiles'], 'Microsoft\\Edge\\Application\\msedge.exe', 'Edge'],
  ];
  for (const [base, rel, name] of candidates) {
    if (!base) continue;
    const exe = path.join(base, rel);
    if (fs.existsSync(exe)) return { exe, name };
  }
  return null;
}

let cache = null, cacheAt = 0;
async function status() {
  if (process.env.PP_FAKE_VR) return { runtime: 'SteamVR', apps: ['SteamVR'], headsetActive: true, browser: 'Chrome' }; // teste
  if (process.platform !== 'win32') return { runtime: null, apps: [], headsetActive: false, browser: null };
  if (cache && Date.now() - cacheAt < 2500) return cache;
  const [rt, apps] = await Promise.all([activeRuntime(), runningVrApps()]);
  const browser = findBrowser();
  cache = {
    runtime: rt?.label || null,
    apps,
    headsetActive: apps.length > 0, // runtime instalado + programa do headset aberto
    browser: browser?.name || null,
  };
  cacheAt = Date.now();
  return cache;
}

const clean = (s, n) => String(s ?? '').replace(/[^\p{L}\p{N} _\-#]/gu, '').slice(0, n);

// abre o jogo numa janela de app do Chrome/Edge (sem barra de endereço), já pronto p/ VR
function openInBrowser(gameUrl, join, shell, profileDir) {
  if (!gameUrl) return { ok: false, reason: 'O VR no PC precisa do jogo online (configure "gameUrl" no config.json).' };
  const url = new URL(gameUrl);
  url.searchParams.set('client', 'pcvr');
  url.searchParams.set('vr', '1');
  if (join?.name) url.searchParams.set('name', clean(join.name, 14));
  if (join?.color) url.searchParams.set('color', clean(join.color, 7));
  if (join?.room) url.searchParams.set('room', clean(join.room, 8));
  const browser = findBrowser();
  if (browser) {
    // perfil próprio = processo novo do navegador a cada vez (o Chrome tem um bug em que,
    // com SteamVR, só a 1ª sessão de VR do processo funciona direito — Chromium 40859047)
    // --disable-features=XRSandbox: o runtime OpenXR do SteamVR não funciona dentro do
    // sandbox de XR do Chrome e a página trava ("não está respondendo") — three.js #30505.
    // Vale só para esta janela do jogo (perfil próprio), não para o Chrome normal da pessoa.
    const args = [`--app=${url.toString()}`, '--new-window', '--no-first-run', '--no-default-browser-check',
      '--disable-features=XRSandbox'];
    if (profileDir) args.unshift(`--user-data-dir=${profileDir}`);
    const child = spawn(browser.exe, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, browser: browser.name };
  }
  shell.openExternal(url.toString());
  return { ok: true, browser: 'padrão' };
}

module.exports = { status, openInBrowser };
