const express = require('express');
const os = require('os');

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function publicBooking(b) {
  const total = Number(b.totalAmount) || 0;
  const paid = Number(b.paidAmount) || 0;
  return {
    id: b.id,
    customerName: b.customerName || '',
    phone: b.phone || '',
    eventDate: b.eventDate || '',
    dueDate: b.dueDate || '',
    totalAmount: total,
    paidAmount: paid,
    remaining: Math.max(0, total - paid),
    paymentType: b.paymentType || '',
    foodLocation: b.foodLocation || '',
    coordinatorName: b.coordinatorName || '',
    djName: b.djName || '',
    photographerName: b.photographerName || '',
    assistantsCount: b.assistantsCount || 0,
    notes: b.notes || ''
  };
}

function checkToken(req, expectedToken) {
  if (!expectedToken) return false;
  const provided = req.query.token || req.headers['x-access-token'];
  return provided && String(provided) === String(expectedToken);
}

// خادم HTTP للقراءة فقط: يوفر بيانات الحجوزات لعملاء الشبكة (أجهزة أخرى + تطبيق أندرويد)
function startServer(store, port) {
  return new Promise((resolve, reject) => {
    const app = express();

    // يسمح لتطبيق الأندرويد (يطلب البيانات مباشرة عبر API) بالوصول من أصل مختلف
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'x-access-token, Content-Type');
      next();
    });

    app.get('/api/ping', (req, res) => res.json({ ok: true }));

    app.get('/api/info', (req, res) => {
      const remote = (store.get('settings') || {}).remoteAccess || {};
      if (!checkToken(req, remote.token)) return res.status(401).json({ error: 'unauthorized' });
      const settings = store.get('settings') || {};
      res.json({
        hallName: settings.hallName || 'قاعة الأفراح',
        hallPhone: settings.hallPhone || '',
        updatedAt: new Date().toISOString()
      });
    });

    app.get('/api/bookings', (req, res) => {
      const remote = (store.get('settings') || {}).remoteAccess || {};
      if (!checkToken(req, remote.token)) return res.status(401).json({ error: 'unauthorized' });
      const bookings = store.get('bookings') || [];
      res.json(bookings.map(publicBooking));
    });

    app.get('/', (req, res) => {
      res.type('html').send(MOBILE_PAGE_HTML);
    });

    const server = app.listen(port, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}

// صفحة موبايل بسيطة (تُقدَّم مباشرة من الخادم) لعرض الحجوزات فقط - بدون تعديل
const MOBILE_PAGE_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>حجوزات القاعة - عرض عن بُعد</title>
<style>
  :root{--bg:#0f172a;--card:#1e293b;--accent:#6366f1;--text:#f1f5f9;--muted:#94a3b8;--ok:#22c55e;--warn:#f59e0b;--danger:#ef4444;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:var(--bg);color:var(--text);}
  header{position:sticky;top:0;background:var(--card);padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:5;}
  header h1{font-size:17px;margin:0 0 4px;}
  header p{margin:0;color:var(--muted);font-size:12px;}
  .wrap{padding:12px;max-width:680px;margin:0 auto;}
  #loginBox{padding:20px;}
  #loginBox input{width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:var(--text);font-size:15px;margin-bottom:10px;}
  #loginBox button{width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:15px;font-weight:600;}
  .search{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:var(--text);font-size:14px;margin-bottom:10px;}
  .card{background:var(--card);border-radius:12px;padding:12px 14px;margin-bottom:10px;border-inline-start:4px solid var(--accent);}
  .card .row1{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
  .card .name{font-weight:700;font-size:15px;}
  .card .date{color:var(--muted);font-size:12px;}
  .card .meta{color:var(--muted);font-size:12.5px;display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;}
  .money{display:flex;justify-content:space-between;font-size:13px;background:#0b1220;border-radius:8px;padding:8px 10px;}
  .money b{font-weight:700;}
  .paid-full{color:var(--ok);}
  .paid-partial{color:var(--warn);}
  .paid-none{color:var(--danger);}
  .empty,.err{text-align:center;color:var(--muted);padding:40px 16px;}
  .refresh{position:fixed;bottom:16px;left:16px;background:var(--accent);color:#fff;border:none;border-radius:999px;width:48px;height:48px;font-size:20px;box-shadow:0 4px 12px rgba(0,0,0,.4);}
  .updated{font-size:11px;color:var(--muted);text-align:center;padding:8px 0;}
</style>
</head>
<body>
<header>
  <h1 id="hallTitle">حجوزات القاعة</h1>
  <p>عرض فقط - عن بُعد</p>
</header>
<div class="wrap">
  <div id="loginBox" style="display:none;">
    <p style="color:var(--muted);font-size:13px;">أدخل رمز الدخول (Token) المعروض في إعدادات البرنامج على الجهاز الرئيسي</p>
    <input id="tokenInput" type="text" placeholder="رمز الدخول">
    <button onclick="saveToken()">دخول</button>
  </div>
  <div id="content" style="display:none;">
    <input class="search" id="searchBox" placeholder="بحث بالاسم أو رقم الهاتف أو التاريخ..." oninput="render()">
    <div id="list"></div>
    <div class="updated" id="updatedAt"></div>
  </div>
</div>
<button class="refresh" onclick="load()" title="تحديث">⟳</button>
<script>
let bookings = [];
function getToken(){ return localStorage.getItem('accessToken') || ''; }
function saveToken(){
  const t = document.getElementById('tokenInput').value.trim();
  if(!t) return;
  localStorage.setItem('accessToken', t);
  load();
}
async function load(){
  const token = getToken();
  if(!token){ document.getElementById('loginBox').style.display='block'; document.getElementById('content').style.display='none'; return; }
  try{
    const infoRes = await fetch('/api/info?token='+encodeURIComponent(token));
    if(infoRes.status === 401){ localStorage.removeItem('accessToken'); document.getElementById('loginBox').style.display='block'; document.getElementById('content').style.display='none'; return; }
    const info = await infoRes.json();
    document.getElementById('hallTitle').textContent = info.hallName || 'حجوزات القاعة';
    const res = await fetch('/api/bookings?token='+encodeURIComponent(token));
    bookings = await res.json();
    document.getElementById('loginBox').style.display='none';
    document.getElementById('content').style.display='block';
    document.getElementById('updatedAt').textContent = 'آخر تحديث: ' + new Date().toLocaleString('ar');
    render();
  }catch(e){
    document.getElementById('list').innerHTML = '<div class="err">تعذر الاتصال بالخادم. تأكد من الشبكة أو VPN.</div>';
  }
}
function render(){
  const q = (document.getElementById('searchBox').value || '').trim();
  const list = document.getElementById('list');
  let items = bookings.slice().sort((a,b)=> (a.eventDate||'').localeCompare(b.eventDate||''));
  if(q){
    items = items.filter(b => (b.customerName+b.phone+b.eventDate).includes(q));
  }
  if(items.length === 0){ list.innerHTML = '<div class="empty">لا توجد حجوزات مطابقة</div>'; return; }
  list.innerHTML = items.map(b=>{
    const cls = b.remaining <= 0 ? 'paid-full' : (b.paidAmount > 0 ? 'paid-partial' : 'paid-none');
    const status = b.remaining <= 0 ? 'مدفوع بالكامل' : (b.paidAmount > 0 ? 'دفعة جزئية' : 'غير مدفوع');
    return '<div class="card">'
      + '<div class="row1"><span class="name">'+esc(b.customerName)+'</span><span class="date">'+esc(b.eventDate)+'</span></div>'
      + '<div class="meta">'
        + (b.phone ? '<span>📞 '+esc(b.phone)+'</span>' : '')
        + (b.coordinatorName ? '<span>🎤 '+esc(b.coordinatorName)+'</span>' : '')
        + (b.djName ? '<span>🎧 '+esc(b.djName)+'</span>' : '')
        + (b.photographerName ? '<span>📷 '+esc(b.photographerName)+'</span>' : '')
      + '</div>'
      + '<div class="money"><span>الإجمالي: <b>'+fmt(b.totalAmount)+'</b></span><span>المتبقي: <b class="'+cls+'">'+fmt(b.remaining)+'</b></span></div>'
      + '<div class="'+cls+'" style="font-size:12px;margin-top:6px;">'+status+'</div>'
      + '</div>';
  }).join('');
}
function fmt(n){ return (Number(n)||0).toLocaleString('ar') + ' د.ع'; }
function esc(s){ return String(s||'').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
load();
</script>
</body>
</html>`;

module.exports = { startServer, getLocalIPs };
