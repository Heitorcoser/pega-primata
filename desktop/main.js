// App de PC (Electron). Duas camadas de atualização automática:
//  1) O jogo em si: se config.json tiver "gameUrl", o app abre o jogo do servidor,
//     então todo deploy novo do site já chega aqui (sem reinstalar). Sem internet,
//     abre a cópia embutida (pasta offline/).
//  2) O próprio app: electron-updater confere os Releases do GitHub, baixa a nova
//     versão em segundo plano e oferece reiniciar para instalar.
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const vr = require('./vr');

let config = { gameUrl: '' };
try { config = { ...config, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) }; } catch { /* usa padrão */ }

let win = null;

function offlineFile() {
  return path.join(__dirname, 'offline', 'index.html');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#20301f',
    autoHideMenuBar: true,
    title: 'Pega Primata',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);

  const query = { client: 'desktop', shell: app.getVersion() };
  let triedOffline = false;
  const loadOffline = () => {
    if (triedOffline) return;
    triedOffline = true;
    win.loadFile(offlineFile(), { query });
  };

  if (config.gameUrl) {
    const url = new URL(config.gameUrl);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    win.loadURL(url.toString()).catch(loadOffline);
    win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => { if (isMainFrame) loadOffline(); });
  } else {
    loadOffline();
  }

  // links externos abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // só no app instalado
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      title: 'Atualização pronta',
      message: `A versão ${info.version} do Pega Primata foi baixada.`,
      detail: 'Reinicie para instalar (ou ela será instalada quando você fechar o jogo).',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (e) => console.warn('auto-update:', e?.message || e));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 30 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  // VR de PC: detecção pelo sistema + abrir no Chrome/Edge (que têm OpenXR)
  ipcMain.handle('vr-status', () => vr.status());
  ipcMain.handle('vr-open', (_e, join) => {
    const r = vr.openInBrowser(config.gameUrl, join, shell);
    if (r.ok && win) win.minimize();
    return r;
  });

  app.whenReady().then(() => {
    createWindow();
    setupAutoUpdate();
    // F11 = tela cheia (só quando a janela do jogo está em foco)
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    });
  });
  app.on('window-all-closed', () => app.quit());
}
