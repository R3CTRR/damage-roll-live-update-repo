const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const DiscordRPC = require('discord-rpc');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ─── CURRENT VERSION ───────────────────────
const CURRENT_VERSION = '0.5.1';
const VERSION_URL     = 'https://r3ctrr.github.io/damage-roll-live-update-repo/version.json';
const GAME_FILE_NAME  = 'index-game.html';
const BUNDLED_FILE    = path.join(__dirname, GAME_FILE_NAME);
const CACHED_FILE     = path.join(app.getPath('userData'), GAME_FILE_NAME);

// ─── AUTO-UPDATE ────────────────────────────
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 6000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const tmp = dest + '.tmp';
        const file = fs.createWriteStream(tmp);
        https.get(url, { timeout: 30000 }, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    fs.rename(tmp, dest, err => {
                        if (err) reject(err); else resolve();
                    });
                });
            });
        }).on('error', err => {
            fs.unlink(tmp, () => {});
            reject(err);
        });
    });
}

function versionNewer(remote, current) {
    const r = remote.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, c.length); i++) {
        const rv = r[i] || 0, cv = c[i] || 0;
        if (rv > cv) return true;
        if (rv < cv) return false;
    }
    return false;
}

async function checkForUpdate() {
    try {
        const info = await fetchJSON(VERSION_URL);
        if (info.version && versionNewer(info.version, CURRENT_VERSION) && info.url) {
            console.log('[Update] New version ' + info.version + ' found — downloading...');
            await downloadFile(info.url, CACHED_FILE);
            console.log('[Update] Download complete.');
            return CACHED_FILE;
        }
    } catch (e) {
        console.log('[Update] Check failed (offline or server unreachable):', e.message);
    }
    if (fs.existsSync(CACHED_FILE)) return CACHED_FILE;
    return BUNDLED_FILE;
}

// ─── DISCORD SETUP ─────────────────────────
const CLIENT_ID = '1485058367704662096';
const LAUNCH_TIME = new Date();

DiscordRPC.register(CLIENT_ID);
const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let rpcReady = false;

rpc.on('ready', () => {
    rpcReady = true;
    setPresence({
        details: 'At the Main Menu',
        state: 'Preparing for battle...',
        largeImageKey: 'game_logo',
        largeImageText: 'Damage Roll'
    });
});

rpc.login({ clientId: CLIENT_ID }).catch(() => {});

// ─── PRESENCE FUNCTION ─────────────────────
function setPresence(activity) {
    if (!rpcReady) return;
    if (!activity.state || activity.state.trim() === '') {
        activity.state = 'Playing Damage Roll';
    }
    rpc.setActivity({
        startTimestamp: LAUNCH_TIME,
        instance: false,
        ...activity
    }).catch(() => {});
}

// ─── RECEIVE UPDATES FROM GAME ─────────────
ipcMain.on('rpc-update', (event, data) => {
    if (data.screen === 'clear') {
        if (rpcReady) rpc.clearActivity().catch(() => {});
        return;
    }
    setPresence({
        details: 'Playing Damage Roll',
        state: 'In Game',
        largeImageKey: 'game_logo',
        largeImageText: 'Damage Roll'
    });
});

// ─── WINDOW SETUP ──────────────────────────
let mainWindow;

app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        title: 'Damage Roll',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        }
    });

    mainWindow.setMenuBarVisibility(false);

    const gameFile = await checkForUpdate();
    mainWindow.loadFile(gameFile);

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.executeJavaScript(
            "if (!window.__audioInit) {" +
            "  window.__audioInit = true;" +
            "  try {" +
            "    if (!window.AC) {" +
            "      window.AC = new (window.AudioContext || window.webkitAudioContext)();" +
            "    }" +
            "    window.AC.resume();" +
            "    if (typeof startMenuAudio === 'function') startMenuAudio();" +
            "  } catch (e) { console.log('audio error', e); }" +
            "}"
        ).catch(() => {});
    });

    globalShortcut.register('F11', () => {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
    });

    globalShortcut.register('Escape', () => {
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    });
});

// ─── CLEANUP ───────────────────────────────
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    rpc.destroy().catch(() => {});
    app.quit();
});
