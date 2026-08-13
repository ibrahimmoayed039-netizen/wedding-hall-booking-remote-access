const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');
const { startServer, getLocalIPs } = require('./server');

const store = new Store({
  name: 'hall-bookings-data',
  defaults: {
    bookings: [],
    settings: {
      hallName: 'قاعة الأفراح',
      hallPhone: '',
      hallAddress: '',
      whatsappCountryCode: '966',
      foodPackages: [],
      printerName: '',
      remoteAccess: {
        enabled: false,
        port: 4500,
        token: crypto.randomBytes(4).toString('hex')
      }
    }
  }
});

let mainWindow;
let remoteServerInstance = null;

// ---------- Remote (read-only) Access Server ----------
async function stopRemoteServer() {
  if (remoteServerInstance) {
    await new Promise((resolve) => remoteServerInstance.close(resolve));
    remoteServerInstance = null;
  }
}

async function applyRemoteServerState() {
  await stopRemoteServer();
  const settings = store.get('settings');
  const remote = settings && settings.remoteAccess;
  if (!remote || !remote.enabled) return;
  try {
    remoteServerInstance = await startServer(store, remote.port || 4500);
  } catch (err) {
    remoteServerInstance = null;
    if (mainWindow) {
      mainWindow.webContents.send('remote:error', String((err && err.message) || err));
    }
  }
}

// ---------- Auto Backup ----------
const AUTO_BACKUP_DIR = path.join(app.getPath('userData'), 'auto-backups');
const MAX_AUTO_BACKUPS = 30;
const AUTO_BACKUP_DEBOUNCE_MS = 60 * 1000; // نسخة تلقائية بعد دقيقة من آخر تعديل
let autoBackupTimer = null;
let lastAutoBackupAt = null;

function ensureAutoBackupDir() {
  try { fs.mkdirSync(AUTO_BACKUP_DIR, { recursive: true }); } catch (err) { /* ignore */ }
}

function pruneOldAutoBackups() {
  try {
    const files = fs.readdirSync(AUTO_BACKUP_DIR)
      .filter(f => f.startsWith('auto-') && f.endsWith('.json'))
      .map(f => ({ name: f, time: fs.statSync(path.join(AUTO_BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    files.slice(MAX_AUTO_BACKUPS).forEach(f => {
      try { fs.unlinkSync(path.join(AUTO_BACKUP_DIR, f.name)); } catch (err) { /* ignore */ }
    });
  } catch (err) { /* ignore */ }
}

function performAutoBackup() {
  try {
    ensureAutoBackupDir();
    const payload = {
      app: 'wedding-hall-booking',
      version: 1,
      auto: true,
      exportedAt: new Date().toISOString(),
      settings: store.get('settings'),
      bookings: store.get('bookings')
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(AUTO_BACKUP_DIR, `auto-${stamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    lastAutoBackupAt = new Date().toISOString();
    pruneOldAutoBackups();
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// يجدول نسخة احتياطية تلقائية بعد فترة هدوء من آخر تعديل (لتفادي تكرار الحفظ مع كل ضغطة)
function scheduleAutoBackup() {
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    performAutoBackup();
  }, AUTO_BACKUP_DEBOUNCE_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // نسخة احتياطية تلقائية عند بدء تشغيل البرنامج
  ensureAutoBackupDir();
  performAutoBackup();
  // تشغيل خادم الوصول عن بُعد (قراءة فقط) إذا كان مفعّلاً في الإعدادات
  applyRemoteServerState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// نسخة احتياطية أخيرة قبل إغلاق البرنامج فورًا (بدون انتظار المؤقت)
app.on('before-quit', () => {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }
  performAutoBackup();
  stopRemoteServer();
});

// ---------- IPC: Bookings CRUD ----------

ipcMain.handle('bookings:getAll', () => {
  return store.get('bookings');
});

ipcMain.handle('bookings:save', (event, booking) => {
  const bookings = store.get('bookings');
  if (booking.id) {
    const idx = bookings.findIndex(b => b.id === booking.id);
    if (idx !== -1) {
      bookings[idx] = booking;
    } else {
      bookings.push(booking);
    }
  } else {
    booking.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    booking.createdAt = new Date().toISOString();
    bookings.push(booking);
  }
  store.set('bookings', bookings);
  performAutoBackup();
  return booking;
});

ipcMain.handle('bookings:delete', (event, id) => {
  const bookings = store.get('bookings').filter(b => b.id !== id);
  store.set('bookings', bookings);
  scheduleAutoBackup();
  return true;
});

ipcMain.handle('bookings:replaceAll', (event, bookings) => {
  store.set('bookings', Array.isArray(bookings) ? bookings : []);
  scheduleAutoBackup();
  return store.get('bookings');
});

ipcMain.handle('settings:get', () => {
  return store.get('settings');
});

ipcMain.handle('settings:save', (event, settings) => {
  store.set('settings', settings);
  scheduleAutoBackup();
  applyRemoteServerState();
  return settings;
});

// ---------- IPC: Remote (read-only) Access ----------

ipcMain.handle('remote:getInfo', () => {
  const settings = store.get('settings');
  const remote = (settings && settings.remoteAccess) || { enabled: false, port: 4500, token: '' };
  return {
    enabled: !!remote.enabled,
    port: remote.port || 4500,
    token: remote.token || '',
    localIPs: getLocalIPs(),
    running: !!remoteServerInstance
  };
});

ipcMain.handle('remote:setEnabled', async (event, enabled) => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { port: 4500, token: crypto.randomBytes(4).toString('hex') };
  settings.remoteAccess.enabled = !!enabled;
  store.set('settings', settings);
  await applyRemoteServerState();
  return {
    enabled: !!settings.remoteAccess.enabled,
    port: settings.remoteAccess.port,
    token: settings.remoteAccess.token,
    localIPs: getLocalIPs(),
    running: !!remoteServerInstance
  };
});

ipcMain.handle('remote:regenerateToken', async () => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { enabled: false, port: 4500 };
  settings.remoteAccess.token = crypto.randomBytes(4).toString('hex');
  store.set('settings', settings);
  await applyRemoteServerState();
  return settings.remoteAccess.token;
});

// ---------- IPC: Printing ----------

ipcMain.handle('printers:list', async () => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map(p => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: !!p.isDefault
    }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('print:content', (event, options) => {
  const printerName = (options && options.printerName) || undefined;
  return new Promise((resolve) => {
    mainWindow.webContents.print(
      { silent: true, printBackground: true, deviceName: printerName },
      (success, errorType) => {
        resolve({ success, errorType: success ? null : (errorType || 'unknown') });
      }
    );
  });
});

ipcMain.handle('print:toPDF', async (event, options) => {
  try {
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: false
    });
    const defaultName = (options && options.fileName) || 'مستند.pdf';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ كملف PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    fs.writeFileSync(result.filePath, data);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ---------- IPC: Open external links (e.g. WhatsApp) ----------

ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    if (!/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) {
      throw new Error('Blocked non-whitelisted URL');
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ---------- IPC: Backup export / import ----------

ipcMain.handle('backup:export', async (event, jsonString) => {
  try {
    const defaultName = 'نسخة-احتياطية-حجوزات-' + new Date().toISOString().slice(0, 10) + '.json';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ نسخة احتياطية',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    fs.writeFileSync(result.filePath, jsonString, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// ---------- IPC: Auto Backup info / folder ----------

ipcMain.handle('backup:autoInfo', () => {
  ensureAutoBackupDir();
  let files = [];
  try {
    files = fs.readdirSync(AUTO_BACKUP_DIR)
      .filter(f => f.startsWith('auto-') && f.endsWith('.json'))
      .map(f => {
        const st = fs.statSync(path.join(AUTO_BACKUP_DIR, f));
        return { name: f, time: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  } catch (err) { /* ignore */ }
  return {
    dir: AUTO_BACKUP_DIR,
    count: files.length,
    latest: files[0] ? files[0].time : lastAutoBackupAt
  };
});

ipcMain.handle('backup:openAutoFolder', async () => {
  ensureAutoBackupDir();
  const err = await shell.openPath(AUTO_BACKUP_DIR);
  return { success: !err, error: err || null };
});

ipcMain.handle('backup:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر ملف النسخة الاحتياطية',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { success: false, canceled: true };
    }
    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    return { success: true, data, filePath: result.filePaths[0] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
