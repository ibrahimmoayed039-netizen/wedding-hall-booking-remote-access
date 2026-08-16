const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('electron-store');
const XLSX = require('xlsx');
const { startServer, getLocalIPs } = require('./server');

const store = new Store({
  name: 'hall-bookings-data',
  defaults: {
    bookings: [],
    expenses: [],
    pendingBookings: [],
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
        token: crypto.randomBytes(4).toString('hex'),
        publicEnabled: false,
        allowBookingRequests: false,
        ntfyTopic: 'hall-' + crypto.randomBytes(6).toString('hex')
      }
    }
  }
});

let mainWindow;
let remoteServerInstance = null;
let cloudflareTunnelHandle = null;
let publicTunnelUrl = null;
let publicTunnelStatus = 'stopped'; // stopped | connecting | ready | error
let publicTunnelError = null;
let publicTunnelDiagLog = []; // آخر أسطر تشخيصية من عملية cloudflared الفرعية (للمساعدة باكتشاف سبب الفشل)
const TUNNEL_TIMEOUT_MS = 25000; // إذا ما جاء رابط خلال هذي المدة، على الأغلب الشبكة تمنع الاتصال
let tunnelStarting = false; // يمنع تشغيل أكثر من نفق بنفس الوقت (سبب رئيسي لمشكلة الانهيار)

// ---------- شبكة أمان: يمنع انهيار البرنامج بالكامل بسبب خلل داخلي بمكتبة cloudflared ----------
// مكتبة cloudflared (المسؤولة عن "الرابط العام") فيها خلل معروف: أحيانًا تطلق حدث "error"
// بدون أي مستمع مسجّل له، و Node.js بشكل افتراضي "يرمي" ذلك الخطأ كاستثناء غير ملتقط،
// وإذا حاولت المكتبة إعادة المحاولة بشكل متزامن عند كل رمي، تتكوّن حلقة استدعاء متداخلة
// تنهار الذاكرة (Maximum call stack size exceeded) وتظهر نافذة الخطأ وتوقف البرنامج.
// هذا المعالج يمنع الانهيار الكامل، ويعيد حالة الرابط العام إلى "خطأ" بدل تعطيل البرنامج كله.
process.on('uncaughtException', (err) => {
  const msg = String((err && err.stack) || (err && err.message) || err);
  console.error('[uncaughtException]', msg);
  if (/tunnel/i.test(msg) || /cloudflared/i.test(msg) || /call stack/i.test(msg)) {
    tunnelStarting = false;
    cloudflareTunnelHandle = null;
    publicTunnelUrl = null;
    publicTunnelStatus = 'error';
    publicTunnelError = 'تعذر تشغيل الرابط العام (خلل داخلي بأداة الربط). الرابط المحلي عبر الشبكة/Radmin غير متأثر ويستمر بالعمل.';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('remote:error', publicTunnelError);
    }
    return; // لا نوقف التطبيق - نكمل العمل بشكل طبيعي بدون الرابط العام فقط
  }
  // أي خطأ غير متوقع آخر: نسجله فقط ولا نوقف البرنامج قسريًا حتى لا تضيع بيانات المستخدم
});

// ---------- Remote (read-only) Access Server ----------
async function stopRemoteServer() {
  if (remoteServerInstance) {
    await new Promise((resolve) => remoteServerInstance.close(resolve));
    remoteServerInstance = null;
  }
}

// ---------- الرابط العام عبر Cloudflare Tunnel (بدون فتح منفذ بالراوتر) ----------
function pushDiagLine(line) {
  const clean = String(line || '').trim();
  if (!clean) return;
  publicTunnelDiagLog.push(clean);
  if (publicTunnelDiagLog.length > 40) publicTunnelDiagLog.shift();
}

function diagSuffix() {
  if (!publicTunnelDiagLog.length) return '';
  return ' [سجل تشخيصي متاح - اضغط "نسخ سجل التشخيص" بالإعدادات]';
}

async function stopCloudflareTunnel() {
  if (cloudflareTunnelHandle) {
    try { cloudflareTunnelHandle.stop(); } catch (e) { /* تجاهل */ }
    cloudflareTunnelHandle = null;
  }
  tunnelStarting = false;
  publicTunnelUrl = null;
  publicTunnelStatus = 'stopped';
  publicTunnelError = null;
  publicTunnelDiagLog = [];
}

async function startCloudflareTunnel(port) {
  // يمنع تشغيل أكثر من نفق بنفس الوقت (يحصل مثلاً لو المستخدم بدّل الإعدادات بسرعة) -
  // تشغيل نفقين معًا كان سببًا رئيسيًا لخلل "Maximum call stack size exceeded"
  if (tunnelStarting) return;
  tunnelStarting = true;
  const { bin, install, tunnel } = require('cloudflared');
  publicTunnelStatus = 'connecting';
  publicTunnelError = null;
  publicTunnelDiagLog = [];
  try {
    await install(bin); // يحمّل ملف cloudflared مرة واحدة فقط إذا ما كان موجود (يحتاج إنترنت أول مرة)
  } catch (err) {
    tunnelStarting = false;
    publicTunnelStatus = 'error';
    publicTunnelError = 'تعذر تحميل أداة الربط (يحتاج اتصال إنترنت أول مرة): ' + String((err && err.message) || err);
    return;
  }
  try {
    // نجبر استخدام بروتوكول http2 بدل QUIC الافتراضي:
    // QUIC يعتمد على UDP على المنفذ 7844، وكثير من الشبكات/مزودي الإنترنت يحجبون UDP
    // بهذا المنفذ تحديدًا حتى مع وجود إنترنت طبيعي لتصفح المواقع (التصفح يستخدم TCP).
    // http2 يعتمد على TCP العادي، وهو الأكثر توافقًا مع الشبكات المقيّدة.
    const { url, stop, child } = tunnel({ '--url': `http://localhost:${port}`, '--protocol': 'http2' });
    cloudflareTunnelHandle = { stop };
    // نلتقط أخطاء عملية cloudflared الفرعية بأنفسنا حتى لا تتحول لاستثناء غير ملتقط بالمكتبة
    if (child && typeof child.on === 'function') {
      child.on('error', (err) => {
        publicTunnelStatus = 'error';
        publicTunnelError = 'تعذر تشغيل عملية أداة الربط: ' + String((err && err.message) || err);
      });
      child.on('exit', (code) => {
        if (publicTunnelStatus === 'ready' && code !== 0) {
          publicTunnelStatus = 'error';
          publicTunnelError = 'توقفت أداة الربط بشكل غير متوقع (رمز الخروج: ' + code + ').' + diagSuffix();
          cloudflareTunnelHandle = null;
          publicTunnelUrl = null;
        }
      });
    }
    // نلتقط سجل التشخيص الخام من cloudflared (stdout/stderr) - يفيد لمعرفة سبب الفشل الحقيقي
    // (مثلاً: حظر DPI، رفض اتصال، DNS، مهلة انتهت) بدل رسالة عامة غير مفيدة
    if (child && child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (buf) => {
        String(buf).split('\n').forEach(pushDiagLine);
      });
    }
    if (child && child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (buf) => {
        String(buf).split('\n').forEach(pushDiagLine);
      });
    }

    // مهلة زمنية: لو ما وصل رابط خلال المدة المحددة، الأغلب إن الشبكة تمنع الاتصال بخدمة النفق
    // (وليس مجرد بطء) - نوقف المحاولة ونعطي تشخيص واضح بدل ترك الحالة "جارِ الإنشاء..." للأبد
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TUNNEL_TIMEOUT')), TUNNEL_TIMEOUT_MS);
    });
    publicTunnelUrl = await Promise.race([url, timeoutPromise]);
    publicTunnelStatus = 'ready';
    if (mainWindow) mainWindow.webContents.send('remote:publicReady', publicTunnelUrl);
    notifyNewPublicUrl(publicTunnelUrl);
  } catch (err) {
    try { cloudflareTunnelHandle && cloudflareTunnelHandle.stop(); } catch (e) { /* تجاهل */ }
    cloudflareTunnelHandle = null;
    publicTunnelStatus = 'error';
    if (err && err.message === 'TUNNEL_TIMEOUT') {
      publicTunnelError = 'انتهت المهلة (' + (TUNNEL_TIMEOUT_MS / 1000) + ' ثانية) بدون الحصول على رابط - على الأغلب الشبكة/مزود الإنترنت يمنع الاتصال بخدمة النفق (Cloudflare Tunnel).' + diagSuffix()
        + ' جرّب: 1) شبكة إنترنت أخرى (مثلاً بيانات الجوال) للتأكد، 2) أطفئ أي VPN أو برنامج حجب إعلانات، 3) لو تكرر الفشل استخدم بديل Radmin VPN (فعّال ولا يعتمد على هذي الخدمة إطلاقاً).';
    } else {
      publicTunnelError = String((err && err.message) || err) + diagSuffix();
    }
  } finally {
    tunnelStarting = false;
  }
}

// ---------- إشعار تلقائي على الجوال (ntfy.sh) عند تغيّر الرابط العام ----------
async function notifyNewPublicUrl(url) {
  try {
    const settings = store.get('settings');
    const topic = settings && settings.remoteAccess && settings.remoteAccess.ntfyTopic;
    if (!topic) return;
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        'Title': encodeURIComponent('رابط جديد لحجوزات القاعة'),
        'Click': url
      },
      body: `الرابط الجديد للوصول عن بُعد:\n${url}`
    });
  } catch (err) {
    // فشل الإشعار مو حرج، نتجاهله بصمت
  }
}

// ---------- إشعار عند وصول طلب حجز أولي جديد من تطبيق الجوال ----------
async function notifyNewPendingBooking(pending) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pending:new', pending);
    }
  } catch (e) { /* تجاهل */ }
  try {
    const settings = store.get('settings');
    const topic = settings && settings.remoteAccess && settings.remoteAccess.ntfyTopic;
    if (!topic) return;
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Title': encodeURIComponent('طلب حجز جديد من الجوال') },
      body: `العميل: ${pending.customerName || '—'}\nالتاريخ: ${pending.eventDate || '—'}\nراجع تبويب "طلبات الجوال" لقبول الطلب أو رفضه.`
    });
  } catch (err) {
    // فشل الإشعار مو حرج، نتجاهله بصمت
  }
}

async function applyRemoteServerState() {
  await stopRemoteServer();
  await stopCloudflareTunnel();
  const settings = store.get('settings');
  const remote = settings && settings.remoteAccess;
  if (!remote || !remote.enabled) return;
  try {
    remoteServerInstance = await startServer(store, remote.port || 4500, notifyNewPendingBooking);
  } catch (err) {
    remoteServerInstance = null;
    if (mainWindow) {
      mainWindow.webContents.send('remote:error', String((err && err.message) || err));
    }
    return;
  }
  if (remote.publicEnabled) {
    // لا ننتظرها هنا حتى لا نعطّل بدء البرنامج - تعمل بالخلفية وتحدّث حالتها
    startCloudflareTunnel(remote.port || 4500);
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
      bookings: store.get('bookings'),
      expenses: store.get('expenses')
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
  stopCloudflareTunnel();
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

// ---------- IPC: طلبات الحجز الأولية الواردة من تطبيق الجوال (وضع عدم الاتصال بالكتابة) ----------

ipcMain.handle('pending:getAll', () => {
  return store.get('pendingBookings') || [];
});

ipcMain.handle('pending:delete', (event, id) => {
  const list = (store.get('pendingBookings') || []).filter(p => p.id !== id);
  store.set('pendingBookings', list);
  return list;
});

// ---------- IPC: Expenses CRUD (صندوق المصاريف) ----------

ipcMain.handle('expenses:getAll', () => {
  return store.get('expenses');
});

ipcMain.handle('expenses:save', (event, expense) => {
  const expenses = store.get('expenses');
  if (expense.id) {
    const idx = expenses.findIndex(x => x.id === expense.id);
    if (idx !== -1) {
      expenses[idx] = expense;
    } else {
      expenses.push(expense);
    }
  } else {
    expense.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    expense.createdAt = new Date().toISOString();
    expenses.push(expense);
  }
  store.set('expenses', expenses);
  performAutoBackup();
  return expense;
});

ipcMain.handle('expenses:delete', (event, id) => {
  const expenses = store.get('expenses').filter(x => x.id !== id);
  store.set('expenses', expenses);
  scheduleAutoBackup();
  return true;
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

function buildRemoteInfoResponse() {
  const settings = store.get('settings');
  const remote = (settings && settings.remoteAccess) || { enabled: false, port: 4500, token: '', publicEnabled: false, ntfyTopic: '' };
  return {
    enabled: !!remote.enabled,
    port: remote.port || 4500,
    token: remote.token || '',
    localIPs: getLocalIPs(),
    running: !!remoteServerInstance,
    publicEnabled: !!remote.publicEnabled,
    publicUrl: publicTunnelUrl,
    publicStatus: publicTunnelStatus,
    publicError: publicTunnelError,
    publicDiagLog: publicTunnelDiagLog.join('\n'),
    ntfyTopic: remote.ntfyTopic || '',
    allowBookingRequests: !!remote.allowBookingRequests,
    pendingCount: (store.get('pendingBookings') || []).length
  };
}

ipcMain.handle('remote:getInfo', () => buildRemoteInfoResponse());

ipcMain.handle('remote:setEnabled', async (event, enabled) => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { port: 4500, token: crypto.randomBytes(4).toString('hex'), publicEnabled: false };
  settings.remoteAccess.enabled = !!enabled;
  store.set('settings', settings);
  await applyRemoteServerState();
  return buildRemoteInfoResponse();
});

ipcMain.handle('remote:setPublicEnabled', async (event, enabled) => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { enabled: false, port: 4500, token: crypto.randomBytes(4).toString('hex') };
  settings.remoteAccess.publicEnabled = !!enabled;
  store.set('settings', settings);
  await applyRemoteServerState();
  return buildRemoteInfoResponse();
});

ipcMain.handle('remote:setAllowBookingRequests', async (event, enabled) => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { enabled: false, port: 4500, publicEnabled: false };
  settings.remoteAccess.allowBookingRequests = !!enabled;
  store.set('settings', settings);
  return buildRemoteInfoResponse();
});

ipcMain.handle('remote:regenerateToken', async () => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { enabled: false, port: 4500, publicEnabled: false };
  settings.remoteAccess.token = crypto.randomBytes(4).toString('hex');
  store.set('settings', settings);
  await applyRemoteServerState();
  return settings.remoteAccess.token;
});

ipcMain.handle('remote:regenerateNtfyTopic', async () => {
  const settings = store.get('settings');
  settings.remoteAccess = settings.remoteAccess || { enabled: false, port: 4500, publicEnabled: false };
  settings.remoteAccess.ntfyTopic = 'hall-' + crypto.randomBytes(6).toString('hex');
  store.set('settings', settings);
  return settings.remoteAccess.ntfyTopic;
});

// ---------- IPC: تشخيص الاتصال بالإنترنت/خدمة النفق (يساعد بمعرفة سبب فشل الرابط العام) ----------
ipcMain.handle('remote:testConnectivity', async () => {
  async function checkUrl(name, testUrl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const res = await fetch(testUrl, { signal: controller.signal, method: 'GET' });
      return { name, ok: true, status: res.status, ms: Date.now() - startedAt };
    } catch (err) {
      return { name, ok: false, error: String((err && err.message) || err), ms: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }
  const results = await Promise.all([
    checkUrl('إنترنت عام (google.com)', 'https://www.google.com/generate_204', 8000),
    checkUrl('نطاق Cloudflare (cloudflare.com)', 'https://www.cloudflare.com', 8000),
    checkUrl('نطاق الأنفاق (trycloudflare.com)', 'https://trycloudflare.com', 8000)
  ]);
  return results;
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

ipcMain.handle('export:excel', async (event, payload) => {
  try {
    const { fileName, sheets } = payload || {};
    const wb = XLSX.utils.book_new();
    // فتح الملف باتجاه من اليمين لليسار (مناسب للمحتوى العربي) عند فتحه ببرنامج Excel
    wb.Workbook = { Views: [{ RTL: true }] };

    (sheets || []).forEach(sheet => {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows || []);
      // عرض أعمدة مناسب تلقائياً حسب أطول محتوى بكل عمود
      const colCount = (sheet.rows && sheet.rows[0]) ? sheet.rows[0].length : 0;
      const colWidths = [];
      for (let c = 0; c < colCount; c++) {
        let max = 8;
        (sheet.rows || []).forEach(row => {
          const cell = row[c];
          const len = cell === null || cell === undefined ? 0 : String(cell).length;
          if (len > max) max = len;
        });
        colWidths.push({ wch: Math.min(max + 2, 40) });
      }
      ws['!cols'] = colWidths;
      XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').slice(0, 31));
    });

    const defaultName = fileName || ('تقرير-' + new Date().toISOString().slice(0, 10) + '.xlsx');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ تقرير Excel',
      defaultPath: defaultName,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    XLSX.writeFile(wb, result.filePath, { bookSST: false });
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
