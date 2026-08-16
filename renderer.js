let bookings = [];
let expenses = [];
let pendingBookings = [];
let settings = { hallName: 'قاعة الأفراح', hallPhone: '', hallAddress: '', foodPackages: [], printerName: '' };
let currentInstallments = [];
let currentFoodPackages = [];
let currentSettingsFoodPackages = [];
let availablePrinters = [];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const $ = (id) => document.getElementById(id);

// إصلاح مشكلة معروفة بالتطبيقات المبنية على Electron/ويندوز:
// أحيانًا بعد إغلاق رسالة تنبيه (alert)، مثل "لا يوجد رقم هاتف صالح..."،
// تفقد نافذة البرنامج التركيز (focus) ويتوقف استقبال الكتابة بجميع الحقول
// حتى يعيد المستخدم فتح البرنامج من جديد. هذا الإصلاح يعيد التركيز تلقائيًا
// للنافذة والصفحة فور إغلاق أي رسالة تنبيه أو تأكيد، حتى تستمر الكتابة بشكل طبيعي.
function restoreFocusAfterDialog() {
  setTimeout(() => {
    try { window.focus(); } catch (e) { /* تجاهل */ }
    try {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      document.body.focus();
    } catch (e) { /* تجاهل */ }
  }, 30);
}

const nativeAlert = window.alert.bind(window);
window.alert = function (message) {
  const result = nativeAlert(message);
  restoreFocusAfterDialog();
  return result;
};

const nativeConfirm = window.confirm.bind(window);
window.confirm = function (message) {
  const result = nativeConfirm(message);
  restoreFocusAfterDialog();
  return result;
};

const nativePrompt = window.prompt.bind(window);
window.prompt = function (message, defaultValue) {
  const result = nativePrompt(message, defaultValue);
  restoreFocusAfterDialog();
  return result;
};

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  $('tab-' + tab).classList.add('active');
  if (tab === 'reports') renderReport();
  if (tab === 'availability') renderAvailabilityCalendar();
  if (tab === 'expenses') renderExpensesTable();
  if (tab === 'pending') renderPendingList();
}

// ---------------- Init ----------------
async function init() {
  bookings = await window.api.getBookings();
  expenses = await window.api.getExpenses();
  settings = await window.api.getSettings();
  if (!settings.foodPackages) settings.foodPackages = [];
  if (!settings.printerName) settings.printerName = '';
  if (!settings.whatsappCountryCode) settings.whatsappCountryCode = '966';
  if (!settings.hallLocation) settings.hallLocation = '';
  if (!settings.hallLogo) settings.hallLogo = '';
  applySettingsToUI();
  renderBookingsTable();
  renderFoodPackagesChecklist();
  loadPrinters();
  if (window.api.getPendingBookings) {
    pendingBookings = await window.api.getPendingBookings();
    updatePendingBadge();
  }
  if (window.api.onPendingNew) {
    window.api.onPendingNew(async () => {
      pendingBookings = await window.api.getPendingBookings();
      updatePendingBadge();
      if (document.getElementById('tab-pending').classList.contains('active')) renderPendingList();
    });
  }
}
init();

// ---------------- طلبات الحجز الأولية من تطبيق الجوال ----------------
function updatePendingBadge() {
  const badge = $('pendingBadge');
  if (!badge) return;
  const n = pendingBookings.length;
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'inline-block' : 'none';
}

function renderPendingList() {
  const wrap = $('pendingList');
  const emptyMsg = $('pendingEmptyMsg');
  if (!wrap) return;
  if (pendingBookings.length === 0) {
    wrap.innerHTML = '';
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';
  const sorted = pendingBookings.slice().sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  wrap.innerHTML = sorted.map(p => {
    const dateTaken = bookings.some(b => b.eventDate === p.eventDate);
    const conflictNote = dateTaken ? '<div class="p-notes" style="color:#dc2626;">⚠️ هذا التاريخ محجوز مسبقًا - راجع قبل القبول</div>' : '';
    return `<div class="pending-card">
      <div class="p-row1"><span class="p-name">${escapeHtml(p.customerName)}</span><span class="p-date">${escapeHtml(p.eventDate || '')}</span></div>
      <div class="p-meta">
        ${p.phone ? '<span>📞 ' + escapeHtml(p.phone) + '</span>' : ''}
        ${p.depositAmount ? '<span>💰 دفعة أولية: ' + formatMoney(p.depositAmount) + '</span>' : ''}
        ${p.submittedBy ? '<span>👤 ' + escapeHtml(p.submittedBy) + '</span>' : ''}
      </div>
      ${p.notes ? '<div class="p-notes">' + escapeHtml(p.notes) + '</div>' : ''}
      ${conflictNote}
      <div class="p-submitted">أُرسل: ${p.submittedAt ? new Date(p.submittedAt).toLocaleString('ar') : '-'}</div>
      <div class="p-actions">
        <button type="button" class="btn btn-primary btn-small" data-action="acceptPending" data-id="${p.id}">قبول وإكمال الحجز</button>
        <button type="button" class="btn btn-danger btn-small" data-action="rejectPending" data-id="${p.id}">رفض</button>
      </div>
    </div>`;
  }).join('');
}

$('pendingList') && $('pendingList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const pending = pendingBookings.find(p => p.id === id);
  if (!pending) return;

  if (btn.dataset.action === 'rejectPending') {
    if (!confirm('رفض هذا الطلب نهائيًا؟')) return;
    pendingBookings = await window.api.deletePendingBooking(id);
    updatePendingBadge();
    renderPendingList();
    return;
  }

  if (btn.dataset.action === 'acceptPending') {
    resetForm();
    $('customerName').value = pending.customerName || '';
    $('phone').value = pending.phone || '';
    $('eventDate').value = pending.eventDate || '';
    $('paidAmount').value = pending.depositAmount || 0;
    $('notes').value = pending.notes || '';
    updatePaymentFieldsVisibility();
    updateComputedTotal();
    pendingBookings = await window.api.deletePendingBooking(id);
    updatePendingBadge();
    switchTab('newBooking');
    alert('راجع بيانات الحجز وأكملها (السعر وباقي التفاصيل) ثم اضغط "حفظ الحجز".');
  }
});

function applySettingsToUI() {
  $('hallTitle').textContent = settings.hallName || 'نظام حجوزات القاعة';
  $('settingsHallName').value = settings.hallName || '';
  $('settingsHallPhone').value = settings.hallPhone || '';
  $('settingsHallAddress').value = settings.hallAddress || '';
  $('settingsWhatsappCode').value = settings.whatsappCountryCode || '966';
  $('settingsHallLocation').value = settings.hallLocation || '';
  setLogoPreview(settings.hallLogo || '');
  currentSettingsFoodPackages = (settings.foodPackages || []).map(p => ({ ...p }));
  renderSettingsFoodPackagesRows();
}

// ---------------- Printer selection ----------------
async function loadPrinters() {
  if (!window.api.listPrinters) return;
  availablePrinters = await window.api.listPrinters();
  const select = $('settingsPrinter');
  const current = settings.printerName || '';
  select.innerHTML = '<option value="">طابعة النظام الافتراضية</option>';
  availablePrinters.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.displayName + (p.isDefault ? ' (افتراضية)' : '');
    select.appendChild(opt);
  });
  select.value = current;
}

const refreshPrintersBtn = $('refreshPrintersBtn');
if (refreshPrintersBtn) {
  refreshPrintersBtn.addEventListener('click', loadPrinters);
}

// ---------------- Bookings Table ----------------
let sortState = { key: 'eventDate', direction: 'desc' };

const NUMERIC_SORT_KEYS = new Set(['totalAmount', 'remaining']);

function getSortValue(b, key) {
  const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
  switch (key) {
    case 'customerName': return b.customerName || '';
    case 'phone': return b.phone || '';
    case 'eventDate': return b.eventDate || '';
    case 'photographer': return formatProvider(b.photographerType, b.photographerName);
    case 'dj': return formatProvider(b.djType, b.djName);
    case 'coordinator': return formatProvider(b.coordinatorType, b.coordinatorName);
    case 'foodLocation': return b.foodLocation || '';
    case 'paymentType': return b.paymentType || '';
    case 'totalAmount': return Number(b.totalAmount) || 0;
    case 'remaining': return remaining;
    default: return '';
  }
}

function sortBookings(list) {
  const { key, direction } = sortState;
  const dir = direction === 'asc' ? 1 : -1;
  const numeric = NUMERIC_SORT_KEYS.has(key);
  return list.slice().sort((a, b) => {
    const va = getSortValue(a, key);
    const vb = getSortValue(b, key);
    if (numeric) return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'ar') * dir;
  });
}

function updateSortHeaderUI() {
  document.querySelectorAll('#bookingsTable thead th[data-sort-key]').forEach(th => {
    const key = th.dataset.sortKey;
    th.classList.toggle('sort-active', key === sortState.key);
    let arrow = th.querySelector('.sort-arrow');
    if (!arrow) {
      arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      th.appendChild(arrow);
    }
    arrow.textContent = key === sortState.key ? (sortState.direction === 'asc' ? '▲' : '▼') : '⇅';
  });
}

document.querySelectorAll('#bookingsTable thead th[data-sort-key]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sortKey;
    if (sortState.key === key) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState = { key, direction: 'asc' };
    }
    renderBookingsTable();
  });
});

function renderBookingsTable() {
  const search = $('searchInput').value.trim().toLowerCase();
  const dateFilter = $('filterDate').value;

  let list = sortBookings(bookings);

  if (search) {
    list = list.filter(b =>
      (b.customerName || '').toLowerCase().includes(search) ||
      (b.phone || '').toLowerCase().includes(search)
    );
  }
  if (dateFilter) {
    list = list.filter(b => b.eventDate === dateFilter);
  }

  const tbody = $('bookingsTableBody');
  tbody.innerHTML = '';

  $('emptyState').style.display = list.length === 0 ? 'block' : 'none';

  list.forEach(b => {
    const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(b.customerName)}</td>
      <td>${escapeHtml(b.phone)}</td>
      <td>${escapeHtml(b.eventDate)}</td>
      <td>${formatMoney(b.totalAmount)}</td>
      <td>
        <button class="btn btn-light btn-small" data-action="edit" data-id="${b.id}">تعديل</button>
        ${remaining > 0 ? `<button class="btn btn-success btn-small" data-action="settle" data-id="${b.id}">تسديد</button>` : ''}
        <button class="btn btn-whatsapp btn-small" data-action="whatsapp" data-id="${b.id}">واتساب</button>
        <button class="btn btn-light btn-small" data-action="print" data-id="${b.id}">طباعة</button>
        <button class="btn btn-danger btn-small" data-action="delete" data-id="${b.id}">حذف</button>
      </td>`;
    tbody.appendChild(tr);
  });

  updateSortHeaderUI();
}

$('searchInput').addEventListener('input', renderBookingsTable);
$('filterDate').addEventListener('input', renderBookingsTable);
$('clearFilters').addEventListener('click', () => {
  $('searchInput').value = '';
  $('filterDate').value = '';
  renderBookingsTable();
});

$('bookingsTableBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return;

  if (action === 'edit') {
    loadBookingIntoForm(booking);
    switchTab('newBooking');
  } else if (action === 'delete') {
    if (confirm(`تأكيد حذف حجز "${booking.customerName}"؟`)) {
      await window.api.deleteBooking(id);
      bookings = bookings.filter(b => b.id !== id);
      renderBookingsTable();
    }
  } else if (action === 'print') {
    printReceipt(booking);
  } else if (action === 'settle') {
    settleRemainingDebt(id);
  } else if (action === 'whatsapp') {
    sendReceiptViaWhatsApp(booking);
  }
});

// ---------------- Send Receipt via WhatsApp ----------------
function digitsOnly(str) {
  return (str || '').replace(/\D/g, '');
}

function normalizePhoneForWhatsApp(phone) {
  let digits = digitsOnly(phone);
  if (!digits) return '';
  const cc = digitsOnly(settings.whatsappCountryCode) || '966';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(cc)) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  return cc + digits;
}

function buildReceiptWhatsAppMessage(b) {
  const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
  const hallName = settings.hallName || 'قاعة الأفراح';
  const lines = [];
  lines.push(`*${hallName}*`);
  lines.push('إيصال حجز قاعة ✅');
  lines.push('');
  lines.push(`رقم الإيصال: ${getReceiptNumber(b)}`);
  lines.push(`اسم العميل: ${b.customerName || ''}`);
  lines.push(`تاريخ الحفلة: ${b.eventDate || ''}`);
  lines.push(`كادر التصوير: ${formatProvider(b.photographerType, b.photographerName)}`);
  lines.push(`الديجي: ${formatProvider(b.djType, b.djName)}`);
  lines.push(`المنسقة: ${formatProvider(b.coordinatorType, b.coordinatorName)}`);
  if (Number(b.assistantsCount) > 0) {
    lines.push(`عدد المساعدين/المنظمين: ${b.assistantsCount}`);
  }
  lines.push(`تحضير الطعام: ${b.foodLocation || 'خارج القاعة'}`);

  if (b.foodLocation === 'داخل القاعة' && Array.isArray(b.foodPackages) && b.foodPackages.length) {
    lines.push('');
    lines.push('باكجات الطعام:');
    b.foodPackages.forEach(p => {
      const qty = Number(p.quantity) || 1;
      lines.push(`- ${p.name || ''} × ${qty} = ${formatMoney((Number(p.price) || 0) * qty)}`);
    });
  }

  lines.push('');
  lines.push(`سعر الحجز: ${formatMoney(b.hallPrice)}`);
  lines.push(`المبلغ الإجمالي: ${formatMoney(b.totalAmount)}`);
  lines.push(`المبلغ المدفوع: ${formatMoney(b.paidAmount)}`);
  lines.push(`المبلغ المتبقي: ${formatMoney(remaining)}`);

  if (b.paymentType === 'أقساط' && Array.isArray(b.installments) && b.installments.length) {
    lines.push('');
    lines.push('جدول الأقساط:');
    b.installments.forEach(i => {
      lines.push(`- ${formatMoney(i.amount)} بتاريخ ${i.dueDate || '-'} (${i.paid ? 'مدفوع' : 'غير مدفوع'})`);
    });
  }

  if (b.notes) {
    lines.push('');
    lines.push(`ملاحظات: ${b.notes}`);
  }

  lines.push('');
  lines.push(`شكراً لاختياركم ${hallName} 🌸`);

  return lines.join('\n');
}

function openExternalLink(url) {
  if (window.api && window.api.openExternal) {
    window.api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function sendReceiptViaWhatsApp(b) {
  const phone = normalizePhoneForWhatsApp(b.phone);
  if (!phone) {
    alert('لا يوجد رقم هاتف صالح لهذا العميل لإرسال الوصل عبر واتساب.');
    return;
  }
  const message = buildReceiptWhatsAppMessage(b);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  openExternalLink(url);
}

// ---------------- Settle remaining debt ----------------
async function settleRemainingDebt(id) {
  const booking = bookings.find(b => b.id === id);
  if (!booking) return;

  const total = Number(booking.totalAmount) || 0;
  const paid = Number(booking.paidAmount) || 0;
  const remaining = total - paid;

  if (remaining <= 0) {
    alert('لا يوجد مبلغ متبقٍ على هذا الحجز، تم سداد كامل المبلغ.');
    return;
  }

  const input = prompt(
    `المبلغ المتبقي على حجز "${booking.customerName}" هو ${formatMoney(remaining)}.\nأدخل المبلغ الذي تريد تسجيله كمسدد الآن:`,
    String(remaining)
  );
  if (input === null) return;

  let amount = Number(input);
  if (!amount || isNaN(amount) || amount <= 0) {
    alert('الرجاء إدخال مبلغ صحيح أكبر من صفر.');
    return;
  }
  if (amount > remaining) amount = remaining;

  booking.paidAmount = paid + amount;

  // Keep installment statuses roughly in sync with the new total paid amount
  if (Array.isArray(booking.installments) && booking.installments.length) {
    let runningPaid = booking.paidAmount;
    booking.installments
      .slice()
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .forEach(inst => {
        const instAmount = Number(inst.amount) || 0;
        if (runningPaid >= instAmount) {
          inst.paid = true;
          runningPaid -= instAmount;
        }
      });
  }

  const saved = await window.api.saveBooking(booking);
  const idx = bookings.findIndex(b => b.id === saved.id);
  if (idx !== -1) bookings[idx] = saved;

  renderBookingsTable();
  if ($('tab-reports').classList.contains('active')) renderReport();

  const newRemaining = total - booking.paidAmount;
  alert(`تم تسجيل دفعة بقيمة ${formatMoney(amount)} على حجز "${booking.customerName}".\nالمتبقي الآن: ${formatMoney(newRemaining)}`);
}

// ---------------- Food Packages (when food prepared inside the hall) ----------------
// The master list of packages (name/price/contents) is managed from the Settings tab.
// Here, on the booking form, the user just picks which packages apply to this booking.
const foodLocationEl = $('foodLocation');
foodLocationEl.addEventListener('change', () => {
  updateFoodSectionVisibility();
  updateComputedTotal();
});

function updateFoodSectionVisibility() {
  const inside = foodLocationEl.value === 'داخل القاعة';
  $('foodPackagesSection').style.display = inside ? 'block' : 'none';
  if (inside) renderFoodPackagesChecklist();
}

// ---------------- Provider fields (photographer / DJ / coordinator) ----------------
// Each can be "ضمن القاعة" (included, no name needed) or "خارجي" (external, name required)
function setupProviderTypeField(typeId, nameFieldId) {
  const typeEl = $(typeId);
  const nameFieldEl = $(nameFieldId);
  const update = () => {
    nameFieldEl.style.display = typeEl.value === 'خارجي' ? 'flex' : 'none';
  };
  typeEl.addEventListener('change', update);
  update();
  return update;
}
const updatePhotographerFieldVisibility = setupProviderTypeField('photographerType', 'photographerNameField');
const updateDjFieldVisibility = setupProviderTypeField('djType', 'djNameField');
const updateCoordinatorFieldVisibility = setupProviderTypeField('coordinatorType', 'coordinatorNameField');

function renderFoodPackagesChecklist() {
  const container = $('foodPackagesChecklist');
  const available = settings.foodPackages || [];

  if (available.length === 0) {
    container.innerHTML = '<p class="empty-state">لا توجد باكجات طعام معرّفة بعد. أضفها من تبويب "الإعدادات".</p>';
    updateFoodPackagesTotal();
    return;
  }

  container.innerHTML = '';
  available.forEach(pkg => {
    const selected = currentFoodPackages.find(p => p.id === pkg.id);
    const checked = !!selected;
    const qty = selected ? (selected.quantity || 1) : 1;
    const subtotal = (Number(pkg.price) || 0) * (Number(qty) || 0);
    const label = document.createElement('label');
    label.className = 'food-package-option';
    label.innerHTML = `
      <input type="checkbox" data-id="${pkg.id}" ${checked ? 'checked' : ''}>
      <span class="fp-name">${escapeHtml(pkg.name)}</span>
      <span class="fp-price">${formatMoney(pkg.price)}</span>
      <span class="fp-qty">عدد القطع:
        <input type="number" min="1" step="1" value="${qty}" data-qty-id="${pkg.id}" ${checked ? '' : 'disabled'}>
      </span>
      <span class="fp-subtotal" data-subtotal-id="${pkg.id}">${checked ? formatMoney(subtotal) : ''}</span>
      <span class="fp-contents">${escapeHtml(pkg.contents || '')}</span>`;
    container.appendChild(label);
  });
  updateFoodPackagesTotal();
}

$('foodPackagesChecklist').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const id = e.target.dataset.id;
  const pkg = (settings.foodPackages || []).find(p => p.id === id);
  if (!pkg) return;
  if (e.target.checked) {
    currentFoodPackages.push({ ...pkg, quantity: 1 });
  } else {
    currentFoodPackages = currentFoodPackages.filter(p => p.id !== id);
  }
  renderFoodPackagesChecklist();
});

$('foodPackagesChecklist').addEventListener('input', (e) => {
  const id = e.target.dataset.qtyId;
  if (!id) return;
  const item = currentFoodPackages.find(p => p.id === id);
  if (!item) return;
  item.quantity = Math.max(1, Number(e.target.value) || 1);
  const subtotalEl = document.querySelector(`[data-subtotal-id="${id}"]`);
  if (subtotalEl) subtotalEl.textContent = formatMoney((Number(item.price) || 0) * item.quantity);
  updateFoodPackagesTotal();
});

function updateFoodPackagesTotal() {
  const totalEl = $('foodPackagesTotal');
  const total = currentFoodPackages.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0);
  if (currentFoodPackages.length > 0) {
    totalEl.style.display = 'block';
    totalEl.textContent = 'إجمالي أسعار باكجات الطعام المختارة: ' + formatMoney(total);
  } else {
    totalEl.style.display = 'none';
  }
  updateComputedTotal();
}

// ---------------- Food Packages management (Settings tab) ----------------
$('addSettingsFoodPackageBtn').addEventListener('click', () => {
  currentSettingsFoodPackages.push({ id: genId(), name: '', price: '', contents: '' });
  renderSettingsFoodPackagesRows();
});

function renderSettingsFoodPackagesRows() {
  const body = $('settingsFoodPackagesBody');
  body.innerHTML = '';
  $('settingsFoodPackagesEmpty').style.display = currentSettingsFoodPackages.length === 0 ? 'block' : 'none';
  currentSettingsFoodPackages.forEach((pkg, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" placeholder="مثال: باكج ذهبي" value="${escapeHtml(pkg.name)}" data-idx="${idx}" data-field="name"></td>
      <td><input type="number" min="0" step="1" placeholder="السعر" value="${pkg.price}" data-idx="${idx}" data-field="price"></td>
      <td><input type="text" placeholder="مثال: أرز، لحم، سلطات، مشروبات، حلا" value="${escapeHtml(pkg.contents)}" data-idx="${idx}" data-field="contents"></td>
      <td><button type="button" class="btn btn-danger btn-small" data-idx="${idx}" data-action="removeSettingsFoodPackage">حذف</button></td>`;
    body.appendChild(tr);
  });
}

$('settingsFoodPackagesBody').addEventListener('input', (e) => {
  const idx = e.target.dataset.idx;
  const field = e.target.dataset.field;
  if (idx === undefined || !field) return;
  currentSettingsFoodPackages[idx][field] = e.target.value;
});
$('settingsFoodPackagesBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="removeSettingsFoodPackage"]');
  if (!btn) return;
  currentSettingsFoodPackages.splice(Number(btn.dataset.idx), 1);
  renderSettingsFoodPackagesRows();
});

// ---------------- New / Edit Booking Form ----------------
const paymentTypeEl = $('paymentType');
paymentTypeEl.addEventListener('change', () => {
  updatePaymentFieldsVisibility();
  updateComputedTotal();
});

function updatePaymentFieldsVisibility() {
  const type = paymentTypeEl.value;
  if (type === 'نقد') {
    $('paidAmountField').style.display = 'none';
    $('installmentsSection').style.display = 'none';
  } else {
    $('paidAmountField').style.display = 'flex';
    $('paidAmountLabel').textContent = type === 'عربون' ? 'مبلغ العربون (د.ع)' : 'المبلغ المدفوع حتى الآن (د.ع)';
    $('installmentsSection').style.display = type === 'أقساط' ? 'block' : 'none';
  }
}

// ---------------- سعر الحجز + المجموع (auto-calculated) ----------------
$('hallPrice').addEventListener('input', updateComputedTotal);

function computeTotalAmount() {
  const hallPrice = Number($('hallPrice').value) || 0;
  const insideHall = foodLocationEl.value === 'داخل القاعة';
  const foodTotal = insideHall
    ? currentFoodPackages.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0)
    : 0;
  return hallPrice + foodTotal;
}

function updateComputedTotal() {
  const total = computeTotalAmount();
  $('totalAmount').value = total;
  if (paymentTypeEl.value === 'نقد') {
    $('paidAmount').value = total;
  }
}

$('addInstallmentBtn').addEventListener('click', () => {
  currentInstallments.push({ amount: '', dueDate: '', paid: false });
  renderInstallmentsRows();
});

function renderInstallmentsRows() {
  const body = $('installmentsBody');
  body.innerHTML = '';
  currentInstallments.forEach((inst, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="number" min="0" value="${inst.amount}" data-idx="${idx}" data-field="amount"></td>
      <td><input type="date" value="${inst.dueDate}" data-idx="${idx}" data-field="dueDate"></td>
      <td>
        <select data-idx="${idx}" data-field="paid">
          <option value="false" ${!inst.paid ? 'selected' : ''}>غير مدفوع</option>
          <option value="true" ${inst.paid ? 'selected' : ''}>مدفوع</option>
        </select>
      </td>
      <td><button type="button" class="btn btn-danger btn-small" data-idx="${idx}" data-action="removeInstallment">حذف</button></td>`;
    body.appendChild(tr);
  });
}

$('installmentsBody').addEventListener('input', (e) => {
  const idx = e.target.dataset.idx;
  const field = e.target.dataset.field;
  if (idx === undefined || !field) return;
  let val = e.target.value;
  if (field === 'paid') val = val === 'true';
  currentInstallments[idx][field] = val;
});
$('installmentsBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="removeInstallment"]');
  if (!btn) return;
  currentInstallments.splice(Number(btn.dataset.idx), 1);
  renderInstallmentsRows();
});

// تنبيه فوري بمجرد اختيار تاريخ محجوز مسبقًا (قبل تعبئة باقي النموذج)
$('eventDate').addEventListener('change', () => {
  const selectedDate = $('eventDate').value;
  if (!selectedDate) return;
  const currentId = $('bookingId').value || null;
  const conflict = bookings.find(b => b.eventDate === selectedDate && b.id !== currentId);
  if (conflict) {
    alert(
      'تنبيه: هذا التاريخ (' + selectedDate + ') محجوز مسبقًا!\n' +
      'العميل: ' + (conflict.customerName || '—') +
      (conflict.phone ? '\nالهاتف: ' + conflict.phone : '') +
      '\n\nيمكنك اختيار تاريخ آخر، أو المتابعة لعرض/تعديل هذا الحجز من تبويب الحجوزات.'
    );
  }
});

$('bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const booking = {
    id: $('bookingId').value || null,
    customerName: $('customerName').value.trim(),
    phone: $('phone').value.trim(),
    eventDate: $('eventDate').value,
    photographerType: $('photographerType').value,
    photographerName: $('photographerType').value === 'خارجي' ? $('photographerName').value.trim() : '',
    djType: $('djType').value,
    djName: $('djType').value === 'خارجي' ? $('djName').value.trim() : '',
    coordinatorType: $('coordinatorType').value,
    coordinatorName: $('coordinatorType').value === 'خارجي' ? $('coordinatorName').value.trim() : '',
    assistantsCount: Number($('assistantsCount').value) || 0,
    foodLocation: $('foodLocation').value,
    paymentType: $('paymentType').value,
    hallPrice: Number($('hallPrice').value) || 0,
    totalAmount: computeTotalAmount(),
    paidAmount: Number($('paidAmount').value) || 0,
    installments: $('paymentType').value === 'أقساط' ? currentInstallments : [],
    foodPackages: $('foodLocation').value === 'داخل القاعة' ? currentFoodPackages : [],
    notes: $('notes').value.trim()
  };

  const dateTaken = bookings.some(b => b.eventDate === booking.eventDate && b.id !== booking.id);
  if (dateTaken) {
    alert('لا يمكن الحجز: يوجد حجز آخر بنفس التاريخ (' + booking.eventDate + '). القاعة غير متاحة في هذا التاريخ.');
    return;
  }

  const saved = await window.api.saveBooking(booking);
  const idx = bookings.findIndex(b => b.id === saved.id);
  if (idx !== -1) bookings[idx] = saved; else bookings.push(saved);

  resetForm();
  renderBookingsTable();
  switchTab('bookings');
});

$('resetFormBtn').addEventListener('click', resetForm);

function resetForm() {
  $('bookingForm').reset();
  $('bookingId').value = '';
  $('formTitle').textContent = 'حجز جديد';
  currentInstallments = [];
  currentFoodPackages = [];
  $('hallPrice').value = 0;
  $('assistantsCount').value = 0;
  renderInstallmentsRows();
  renderFoodPackagesChecklist();
  updatePaymentFieldsVisibility();
  updateFoodSectionVisibility();
  updatePhotographerFieldVisibility();
  updateDjFieldVisibility();
  updateCoordinatorFieldVisibility();
  updateComputedTotal();
}

function loadBookingIntoForm(b) {
  $('bookingId').value = b.id;
  $('formTitle').textContent = 'تعديل حجز: ' + b.customerName;
  $('customerName').value = b.customerName || '';
  $('phone').value = b.phone || '';
  $('eventDate').value = b.eventDate || '';
  $('photographerType').value = b.photographerType || 'ضمن القاعة';
  $('photographerName').value = b.photographerName || '';
  $('djType').value = b.djType || 'ضمن القاعة';
  $('djName').value = b.djName || '';
  $('coordinatorType').value = b.coordinatorType || 'ضمن القاعة';
  $('coordinatorName').value = b.coordinatorName || '';
  $('assistantsCount').value = b.assistantsCount || 0;
  $('foodLocation').value = b.foodLocation || 'خارج القاعة';
  $('paymentType').value = b.paymentType || 'نقد';
  $('hallPrice').value = b.hallPrice || 0;
  $('paidAmount').value = b.paidAmount || 0;
  $('notes').value = b.notes || '';
  currentInstallments = (b.installments || []).map(i => ({ ...i }));
  currentFoodPackages = (b.foodPackages || []).map(p => ({ ...p, quantity: p.quantity || 1 }));
  renderInstallmentsRows();
  renderFoodPackagesChecklist();
  updatePaymentFieldsVisibility();
  updateFoodSectionVisibility();
  updatePhotographerFieldVisibility();
  updateDjFieldVisibility();
  updateCoordinatorFieldVisibility();
  updateComputedTotal();
}

// ---------------- Reports ----------------
// ---------------- Expenses (صندوق المصاريف) ----------------
function renderExpensesTable() {
  const monthFilter = $('expenseMonthFilter').value; // format YYYY-MM
  let list = expenses.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (monthFilter) {
    list = list.filter(x => (x.date || '').startsWith(monthFilter));
  }

  const total = list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const byCategory = {};
  list.forEach(x => {
    const cat = x.category || 'أخرى';
    byCategory[cat] = (byCategory[cat] || 0) + (Number(x.amount) || 0);
  });
  const topCategory = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a])[0];

  $('expenseSummary').innerHTML = `
    <div class="summary-card"><div class="label">عدد المصاريف${monthFilter ? ' (الشهر المحدد)' : ''}</div><div class="value">${list.length}</div></div>
    <div class="summary-card"><div class="label">إجمالي المصاريف${monthFilter ? ' (الشهر المحدد)' : ''}</div><div class="value">${formatMoney(total)}</div></div>
    <div class="summary-card"><div class="label">أعلى بند</div><div class="value">${topCategory ? escapeHtml(topCategory) : '—'}</div></div>
  `;

  const body = $('expensesTableBody');
  body.innerHTML = '';
  list.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(x.description)}</td>
      <td>${escapeHtml(x.category || 'أخرى')}</td>
      <td>${escapeHtml(x.date)}</td>
      <td>${formatMoney(x.amount)}</td>
      <td>
        <button class="btn btn-light btn-small" data-action="editExpense" data-id="${x.id}">تعديل</button>
        <button class="btn btn-danger btn-small" data-action="deleteExpense" data-id="${x.id}">حذف</button>
      </td>`;
    body.appendChild(tr);
  });

  $('expensesEmptyState').style.display = list.length === 0 ? 'block' : 'none';
}

$('expenseMonthFilter').addEventListener('input', renderExpensesTable);
$('clearExpenseFilter').addEventListener('click', () => {
  $('expenseMonthFilter').value = '';
  renderExpensesTable();
});

$('expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const expense = {
    id: $('expenseId').value || null,
    description: $('expenseDescription').value.trim(),
    category: $('expenseCategory').value,
    amount: Number($('expenseAmount').value) || 0,
    date: $('expenseDate').value,
    notes: $('expenseNotes').value.trim()
  };
  if (!expense.description || !expense.amount || !expense.date) {
    alert('الرجاء تعبئة الوصف والمبلغ والتاريخ.');
    return;
  }
  const saved = await window.api.saveExpense(expense);
  const idx = expenses.findIndex(x => x.id === saved.id);
  if (idx !== -1) expenses[idx] = saved; else expenses.push(saved);

  resetExpenseForm();
  renderExpensesTable();
});

$('resetExpenseFormBtn').addEventListener('click', resetExpenseForm);

function resetExpenseForm() {
  $('expenseForm').reset();
  $('expenseId').value = '';
  $('expenseFormTitle').textContent = 'إضافة مصروف';
  $('expenseCategory').value = 'تشغيلية';
}

function loadExpenseIntoForm(x) {
  $('expenseId').value = x.id;
  $('expenseFormTitle').textContent = 'تعديل مصروف';
  $('expenseDescription').value = x.description || '';
  $('expenseCategory').value = x.category || 'تشغيلية';
  $('expenseAmount').value = x.amount || 0;
  $('expenseDate').value = x.date || '';
  $('expenseNotes').value = x.notes || '';
}

$('expensesTableBody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const expense = expenses.find(x => x.id === id);
  if (!expense) return;

  if (action === 'editExpense') {
    loadExpenseIntoForm(expense);
  } else if (action === 'deleteExpense') {
    if (confirm(`تأكيد حذف مصروف "${expense.description}"؟`)) {
      await window.api.deleteExpense(id);
      expenses = expenses.filter(x => x.id !== id);
      renderExpensesTable();
    }
  }
});


// ---------------- Report period filter ----------------
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getReportPeriod() {
  const allTime = $('reportAllTime').checked;
  const month = $('reportMonthInput').value || currentMonthStr();
  return { allTime, month };
}

function reportPeriodLabel(period) {
  if (period.allTime) return 'كل الفترات';
  const [y, m] = period.month.split('-').map(Number);
  const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${monthsAr[(m || 1) - 1]} ${y}`;
}

function getReportBookings(period) {
  return bookings
    .filter(b => period.allTime || (b.eventDate && b.eventDate.startsWith(period.month)))
    .slice()
    .sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
}

function getReportExpenses(period) {
  return expenses
    .filter(x => period.allTime || (x.date && x.date.startsWith(period.month)))
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function computeReportTotals(reportBookings, reportExpenses) {
  const totalBookings = reportBookings.length;
  const totalRevenue = reportBookings.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);
  const totalPaid = reportBookings.reduce((s, b) => s + (Number(b.paidAmount) || 0), 0);
  const totalDue = totalRevenue - totalPaid;
  const totalExpenses = reportExpenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  // الربح يُحسب من المبالغ المُحصَّلة فعليًا (المدفوعة) بعد خصم المصاريف،
  // وليس من إجمالي الحجوزات، لأن المتبقي غير المحصَّل ليس ربحًا فعليًا بعد.
  const netProfit = totalPaid - totalExpenses;
  return { totalBookings, totalRevenue, totalPaid, totalDue, totalExpenses, netProfit };
}

function summaryCardsHtml(totals) {
  return `
    <div class="summary-card"><div class="label">عدد الحجوزات</div><div class="value">${totals.totalBookings}</div></div>
    <div class="summary-card"><div class="label">إجمالي المبالغ</div><div class="value">${formatMoney(totals.totalRevenue)}</div></div>
    <div class="summary-card"><div class="label">المبالغ المحصّلة</div><div class="value">${formatMoney(totals.totalPaid)}</div></div>
    <div class="summary-card"><div class="label">المتبقي</div><div class="value">${formatMoney(totals.totalDue)}</div></div>
    <div class="summary-card"><div class="label">إجمالي المصاريف</div><div class="value">${formatMoney(totals.totalExpenses)}</div></div>
    <div class="summary-card"><div class="label">صافي الربح</div><div class="value ${totals.netProfit >= 0 ? 'status-paid' : 'status-due'}">${formatMoney(totals.netProfit)}</div></div>
  `;
}

function renderReport() {
  const period = getReportPeriod();
  const reportBookings = getReportBookings(period);
  const reportExpenses = getReportExpenses(period);
  const totals = computeReportTotals(reportBookings, reportExpenses);

  $('reportSummary').innerHTML = summaryCardsHtml(totals);

  const body = $('reportTableBody');
  body.innerHTML = '';
  reportBookings.forEach(b => {
    const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(b.customerName)}</td>
      <td>${escapeHtml(b.phone)}</td>
      <td>${escapeHtml(b.eventDate)}</td>
      <td>${escapeHtml(b.paymentType)}</td>
      <td>${formatMoney(b.totalAmount)}</td>
      <td>${formatMoney(b.paidAmount)}</td>
      <td class="${remaining > 0 ? 'status-due' : 'status-paid'}">${formatMoney(remaining)}</td>
      <td>${remaining > 0 ? `<button class="btn btn-success btn-small" data-action="settle" data-id="${b.id}">تسديد</button>` : '-'}</td>`;
    body.appendChild(tr);
  });
  if (!reportBookings.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">لا توجد حجوزات في هذه الفترة</td></tr>';
  }

  const expBody = $('reportExpensesTableBody');
  expBody.innerHTML = '';
  reportExpenses.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(x.description)}</td>
      <td>${escapeHtml(x.category)}</td>
      <td>${escapeHtml(x.date)}</td>
      <td>${formatMoney(x.amount)}</td>
      <td>${escapeHtml(x.notes)}</td>`;
    expBody.appendChild(tr);
  });
  if (!reportExpenses.length) {
    expBody.innerHTML = '<tr><td colspan="5" class="empty-state">لا توجد مصاريف في هذه الفترة</td></tr>';
  }
}

$('reportMonthInput').addEventListener('change', renderReport);
$('reportAllTime').addEventListener('change', () => {
  $('reportMonthInput').disabled = $('reportAllTime').checked;
  renderReport();
});
if (!$('reportMonthInput').value) $('reportMonthInput').value = currentMonthStr();

$('reportTableBody').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="settle"]');
  if (!btn) return;
  settleRemainingDebt(btn.dataset.id);
});

function reportFileBaseName(period) {
  const safeHall = (settings.hallName || 'القاعة').replace(/[\\/:*?"<>|]/g, '-');
  const periodPart = period.allTime ? 'كل-الفترات' : period.month;
  return `تقرير-${safeHall}-${periodPart}`;
}

$('printReportBtn').addEventListener('click', () => {
  const period = getReportPeriod();
  const reportBookings = getReportBookings(period);
  const reportExpenses = getReportExpenses(period);
  const totals = computeReportTotals(reportBookings, reportExpenses);

  $('prHallName').textContent = settings.hallName || 'قاعة الأفراح';
  $('prPeriod').textContent = reportPeriodLabel(period);
  $('prDate').textContent = new Date().toLocaleDateString('ar-EG');
  $('prSummary').innerHTML = summaryCardsHtml(totals);

  const body = $('prTableBody');
  body.innerHTML = '';
  reportBookings.forEach(b => {
    const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(b.customerName)}</td>
      <td>${escapeHtml(b.phone)}</td>
      <td>${escapeHtml(b.eventDate)}</td>
      <td>${escapeHtml(b.paymentType)}</td>
      <td>${formatMoney(b.totalAmount)}</td>
      <td>${formatMoney(b.paidAmount)}</td>
      <td>${formatMoney(remaining)}</td>`;
    body.appendChild(tr);
  });

  const expBody = $('prExpensesTableBody');
  expBody.innerHTML = '';
  reportExpenses.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(x.description)}</td>
      <td>${escapeHtml(x.category)}</td>
      <td>${escapeHtml(x.date)}</td>
      <td>${formatMoney(x.amount)}</td>
      <td>${escapeHtml(x.notes)}</td>`;
    expBody.appendChild(tr);
  });

  showPrintPreview('printReportArea', 'معاينة تقرير الحجوزات', reportFileBaseName(period) + '.pdf');
});

$('exportExcelBtn').addEventListener('click', async () => {
  const period = getReportPeriod();
  const reportBookings = getReportBookings(period);
  const reportExpenses = getReportExpenses(period);
  const totals = computeReportTotals(reportBookings, reportExpenses);

  const summarySheet = [
    ['تقرير الحجوزات المالي'],
    ['القاعة', settings.hallName || 'قاعة الأفراح'],
    ['الفترة', reportPeriodLabel(period)],
    ['تاريخ الإصدار', new Date().toLocaleDateString('ar-EG')],
    [],
    ['البند', 'القيمة'],
    ['عدد الحجوزات', totals.totalBookings],
    ['إجمالي المبالغ', totals.totalRevenue],
    ['المبالغ المحصّلة', totals.totalPaid],
    ['المتبقي', totals.totalDue],
    ['إجمالي المصاريف', totals.totalExpenses],
    ['صافي الربح', totals.netProfit]
  ];

  const bookingsSheet = [
    ['اسم العميل', 'الهاتف', 'تاريخ الحفلة', 'طريقة الدفع', 'الإجمالي', 'المدفوع', 'المتبقي']
  ];
  reportBookings.forEach(b => {
    const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
    bookingsSheet.push([b.customerName || '', b.phone || '', b.eventDate || '', b.paymentType || '', Number(b.totalAmount) || 0, Number(b.paidAmount) || 0, remaining]);
  });

  const expensesSheet = [
    ['الوصف', 'التصنيف', 'التاريخ', 'المبلغ', 'ملاحظات']
  ];
  reportExpenses.forEach(x => {
    expensesSheet.push([x.description || '', x.category || '', x.date || '', Number(x.amount) || 0, x.notes || '']);
  });

  const btn = $('exportExcelBtn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'جارِ التصدير...';
  try {
    const result = await window.api.exportExcel({
      fileName: reportFileBaseName(period) + '.xlsx',
      sheets: [
        { name: 'الملخص', rows: summarySheet },
        { name: 'الحجوزات', rows: bookingsSheet },
        { name: 'المصاريف', rows: expensesSheet }
      ]
    });
    if (result && result.success) {
      alert('تم حفظ ملف Excel بنجاح في:\n' + result.filePath);
    } else if (!result || !result.canceled) {
      alert('تعذّر إنشاء ملف Excel. حاول مرة أخرى.');
    }
  } catch (err) {
    alert('تعذّر إنشاء ملف Excel. حاول مرة أخرى.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// ---------------- Monthly Availability ----------------
const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const today = new Date();
let calendarView = { year: today.getFullYear(), month: today.getMonth() }; // month: 0-11

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function todayStr() { return toDateStr(today.getFullYear(), today.getMonth(), today.getDate()); }

function renderAvailabilityCalendar() {
  const { year, month } = calendarView;
  $('availMonthLabel').textContent = `${ARABIC_MONTHS[month]} ${year}`;

  // Map date -> booking for this hall (one booking per date)
  const bookingsByDate = {};
  bookings.forEach(b => { if (b.eventDate) bookingsByDate[b.eventDate] = b; });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const tStr = todayStr();

  const grid = $('calendarGrid');
  grid.innerHTML = '';

  // leading empty cells
  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  let availableCount = 0;
  let bookedCount = 0;
  const availableDates = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toDateStr(year, month, d);
    const booking = bookingsByDate[dateStr];
    const isPast = dateStr < tStr;
    const isToday = dateStr === tStr;

    const cell = document.createElement('div');
    let statusHtml = '';
    let cls = 'cal-day';

    if (booking) {
      bookedCount++;
      cls += ' booked';
      statusHtml = `<span class="cal-day-status">${escapeHtml(booking.customerName || 'محجوز')}</span>`;
      cell.title = `محجوز: ${booking.customerName || ''}${booking.phone ? ' - ' + booking.phone : ''}`;
      cell.addEventListener('click', () => {
        loadBookingIntoForm(booking);
        switchTab('newBooking');
      });
    } else if (isPast) {
      cls += ' past';
      statusHtml = `<span class="cal-day-status">منتهٍ</span>`;
    } else {
      availableCount++;
      availableDates.push(dateStr);
      cls += ' available';
      statusHtml = `<span class="cal-day-status">متاح</span>`;
      cell.title = 'متاح للحجز - اضغط لبدء حجز جديد';
      cell.addEventListener('click', () => startNewBookingOnDate(dateStr));
    }
    if (isToday) cls += ' today';
    cell.className = cls;
    cell.innerHTML = `<span class="cal-day-num">${d}</span>${statusHtml}`;
    grid.appendChild(cell);
  }

  $('availSummary').innerHTML = `
    <div class="summary-card"><div class="label">أيام الشهر</div><div class="value v-total">${daysInMonth}</div></div>
    <div class="summary-card"><div class="label">أيام متاحة</div><div class="value v-available">${availableCount}</div></div>
    <div class="summary-card"><div class="label">أيام محجوزة</div><div class="value v-booked">${bookedCount}</div></div>
  `;

  renderAvailableDatesList(availableDates);
}

function renderAvailableDatesList(availableDates) {
  const list = $('availList');
  const countBadge = $('availListCount');
  const emptyEl = $('availListEmpty');

  countBadge.textContent = availableDates.length + ' يوم';
  list.style.display = availableDates.length ? 'flex' : 'none';
  emptyEl.style.display = availableDates.length ? 'none' : 'block';

  list.innerHTML = '';
  availableDates.forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = ARABIC_WEEKDAYS[d.getDay()];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'avail-chip';
    chip.innerHTML = `<span class="chip-weekday">${weekday}</span>${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]}`;
    chip.addEventListener('click', () => startNewBookingOnDate(dateStr));
    list.appendChild(chip);
  });
}

function startNewBookingOnDate(dateStr) {
  resetForm();
  $('eventDate').value = dateStr;
  switchTab('newBooking');
}

$('prevMonthBtn').addEventListener('click', () => {
  calendarView.month--;
  if (calendarView.month < 0) { calendarView.month = 11; calendarView.year--; }
  renderAvailabilityCalendar();
});
$('nextMonthBtn').addEventListener('click', () => {
  calendarView.month++;
  if (calendarView.month > 11) { calendarView.month = 0; calendarView.year++; }
  renderAvailabilityCalendar();
});
$('todayMonthBtn').addEventListener('click', () => {
  calendarView = { year: today.getFullYear(), month: today.getMonth() };
  renderAvailabilityCalendar();
});

// ---------------- Hall Logo Upload ----------------
let currentLogoDataUrl = '';

function setLogoPreview(dataUrl) {
  currentLogoDataUrl = dataUrl || '';
  const wrap = $('logoPreviewWrap');
  const img = $('logoPreviewImg');
  const removeBtn = $('removeLogoBtn');
  if (currentLogoDataUrl) {
    img.src = currentLogoDataUrl;
    wrap.style.display = 'flex';
    removeBtn.style.display = 'inline-block';
  } else {
    img.src = '';
    wrap.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}

function resizeImageFileToDataURL(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth;
        let height = img.naturalHeight;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('invalid-image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('file-read-error'));
    reader.readAsDataURL(file);
  });
}

$('uploadLogoBtn').addEventListener('click', () => {
  $('logoFileInput').value = '';
  $('logoFileInput').click();
});

$('logoFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    alert('الرجاء اختيار ملف صورة صالح (PNG أو JPEG أو WEBP).');
    return;
  }
  try {
    const dataUrl = await resizeImageFileToDataURL(file, 400, 400);
    setLogoPreview(dataUrl);
  } catch (err) {
    alert('تعذّر معالجة الصورة، حاول بصورة أخرى.');
  }
});

$('removeLogoBtn').addEventListener('click', () => {
  if (!confirm('هل تريد إزالة شعار القاعة؟')) return;
  setLogoPreview('');
});

// ---------------- Settings ----------------
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const foodPackages = currentSettingsFoodPackages
    .map(p => ({ id: p.id || genId(), name: (p.name || '').trim(), price: Number(p.price) || 0, contents: (p.contents || '').trim() }))
    .filter(p => p.name);

  settings = {
    ...settings, // الحفاظ على أي حقول أخرى غير موجودة بهذا النموذج (مثل remoteAccess)
    hallName: $('settingsHallName').value.trim() || 'قاعة الأفراح',
    hallPhone: $('settingsHallPhone').value.trim(),
    hallAddress: $('settingsHallAddress').value.trim(),
    whatsappCountryCode: digitsOnly($('settingsWhatsappCode').value) || '966',
    hallLocation: $('settingsHallLocation').value.trim(),
    hallLogo: currentLogoDataUrl,
    printerName: $('settingsPrinter').value || '',
    foodPackages
  };
  await window.api.saveSettings(settings);
  applySettingsToUI();
  renderFoodPackagesChecklist();
  alert('تم حفظ الإعدادات بنجاح');
});

// ---------------- Backup: Export / Import ----------------
function buildBackupPayload() {
  return {
    app: 'wedding-hall-booking',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    bookings
  };
}

function downloadTextAsFile(text, fileName) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportBackup() {
  const payload = buildBackupPayload();
  const jsonString = JSON.stringify(payload, null, 2);
  const fileName = `نسخة-احتياطية-حجوزات-${new Date().toISOString().slice(0, 10)}.json`;

  if (window.api && window.api.exportBackup) {
    const result = await window.api.exportBackup(jsonString);
    if (result && result.success) {
      alert('تم حفظ النسخة الاحتياطية بنجاح ✅\n' + (result.filePath || ''));
    } else if (result && !result.canceled) {
      alert('حدث خطأ أثناء حفظ النسخة الاحتياطية: ' + (result.error || 'غير معروف'));
    }
  } else {
    downloadTextAsFile(jsonString, fileName);
  }
}

function validateBackupPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return 'ملف غير صالح.';
  if (!Array.isArray(parsed.bookings)) return 'الملف لا يحتوي على بيانات حجوزات صالحة.';
  return null;
}

async function applyImportedBackup(parsed) {
  const importedBookings = parsed.bookings || [];
  const importedSettings = parsed.settings || null;

  if (window.api && window.api.replaceAllBookings) {
    await window.api.replaceAllBookings(importedBookings);
  }
  if (importedSettings && window.api && window.api.saveSettings) {
    await window.api.saveSettings(importedSettings);
  }

  bookings = await window.api.getBookings();
  settings = await window.api.getSettings();

  applySettingsToUI();
  renderFoodPackagesChecklist();
  renderBookingsTable();
  if ($('tab-reports').classList.contains('active')) renderReport();
  if ($('tab-availability').classList.contains('active')) renderAvailabilityCalendar();
}

async function importBackupFromText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    alert('تعذّر قراءة الملف، تأكد أنه ملف نسخة احتياطية صحيح بصيغة JSON.');
    return;
  }

  const errorMsg = validateBackupPayload(parsed);
  if (errorMsg) {
    alert(errorMsg);
    return;
  }

  const bookingsCount = (parsed.bookings || []).length;
  const confirmed = confirm(
    `سيتم استيراد ${bookingsCount} حجز/حجوزات، وسيستبدل هذا جميع البيانات الحالية في التطبيق (الحجوزات وإعدادات القاعة).\n\nهل تريد المتابعة؟`
  );
  if (!confirmed) return;

  await applyImportedBackup(parsed);
  alert('تم استيراد النسخة الاحتياطية بنجاح ✅');
}

async function importBackup() {
  if (window.api && window.api.importBackup) {
    const result = await window.api.importBackup();
    if (!result || result.canceled) return;
    if (!result.success) {
      alert('حدث خطأ أثناء قراءة النسخة الاحتياطية: ' + (result.error || 'غير معروف'));
      return;
    }
    await importBackupFromText(result.data);
  } else {
    $('importBackupFile').value = '';
    $('importBackupFile').click();
  }
}

$('exportBackupBtn').addEventListener('click', exportBackup);
$('importBackupBtn').addEventListener('click', importBackup);
$('importBackupFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importBackupFromText(String(reader.result || ''));
  reader.onerror = () => alert('تعذّر قراءة الملف المحدد.');
  reader.readAsText(file, 'utf-8');
});

// ---------------- Backup: Auto Backup status ----------------
function formatBackupTime(isoString) {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleString('ar-SA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (err) {
    return isoString;
  }
}

async function refreshAutoBackupStatus() {
  const el = $('autoBackupStatus');
  if (!el) return;
  if (!(window.api && window.api.getAutoBackupInfo)) {
    el.textContent = 'النسخ الاحتياطي التلقائي غير متاح في هذه النسخة.';
    return;
  }
  try {
    const info = await window.api.getAutoBackupInfo();
    if (info && info.latest) {
      el.textContent = `آخر نسخة احتياطية تلقائية: ${formatBackupTime(info.latest)} — (${info.count} نسخة محفوظة)`;
    } else {
      el.textContent = 'لم يتم إنشاء أي نسخة احتياطية تلقائية بعد.';
    }
  } catch (err) {
    el.textContent = 'تعذّر التحقق من حالة النسخ الاحتياطي التلقائي.';
  }
}

if ($('openAutoBackupFolderBtn')) {
  $('openAutoBackupFolderBtn').addEventListener('click', async () => {
    if (window.api && window.api.openAutoBackupFolder) {
      const result = await window.api.openAutoBackupFolder();
      if (!result || !result.success) {
        alert('تعذّر فتح مجلد النسخ الاحتياطية التلقائية: ' + (result && result.error ? result.error : 'غير معروف'));
      }
    }
  });
}

refreshAutoBackupStatus();

// ---------------- Print Receipt ----------------
function printReceipt(b) {
  $('rHallName').textContent = settings.hallName || 'قاعة الأفراح';
  $('rHallNameFooter').textContent = settings.hallName || 'قاعة الأفراح';
  $('rHallInfo').textContent = [settings.hallPhone, settings.hallAddress].filter(Boolean).join(' - ');
  const rLogoEl = $('rHallLogo');
  if (settings.hallLogo) {
    rLogoEl.src = settings.hallLogo;
    rLogoEl.style.display = 'block';
  } else {
    rLogoEl.style.display = 'none';
  }
  $('rReceiptNo').textContent = getReceiptNumber(b);
  $('rCustomerName').textContent = b.customerName || '';
  $('rPhone').textContent = b.phone || '';
  $('rEventDate').textContent = b.eventDate || '';
  $('rPhotographer').textContent = formatProvider(b.photographerType, b.photographerName);
  $('rDj').textContent = formatProvider(b.djType, b.djName);
  $('rCoordinator').textContent = formatProvider(b.coordinatorType, b.coordinatorName);
  const rAssistantsWrap = $('rAssistantsWrap');
  if (Number(b.assistantsCount) > 0) {
    $('rAssistants').textContent = b.assistantsCount;
    rAssistantsWrap.style.display = '';
  } else {
    rAssistantsWrap.style.display = 'none';
  }
  $('rFoodLocation').textContent = b.foodLocation || 'خارج القاعة';
  $('rPaymentType').textContent = b.paymentType || '';
  $('rHallPrice').textContent = formatMoney(b.hallPrice);
  $('rTotal').textContent = formatMoney(b.totalAmount);
  $('rPaid').textContent = formatMoney(b.paidAmount);
  const remaining = (Number(b.totalAmount) || 0) - (Number(b.paidAmount) || 0);
  const rRemainingEl = $('rRemaining');
  rRemainingEl.textContent = formatMoney(remaining);
  rRemainingEl.classList.remove('status-due', 'status-paid');
  rRemainingEl.classList.add(remaining > 0 ? 'status-due' : 'status-paid');

  const hasFoodPackages = b.foodLocation === 'داخل القاعة' && (b.foodPackages || []).length > 0;
  $('rFoodPackagesWrap').style.display = hasFoodPackages ? 'block' : 'none';
  if (hasFoodPackages) {
    const fbody = $('rFoodPackagesBody');
    fbody.innerHTML = '';
    b.foodPackages.forEach(p => {
      const qty = Number(p.quantity) || 1;
      const subtotal = (Number(p.price) || 0) * qty;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(p.name || '-')}</td><td>${qty}</td><td>${formatMoney(p.price)}</td><td>${formatMoney(subtotal)}</td><td>${escapeHtml(p.contents || '-')}</td>`;
      fbody.appendChild(tr);
    });
  }

  const hasInstallments = b.paymentType === 'أقساط' && (b.installments || []).length > 0;
  $('rInstallmentsWrap').style.display = hasInstallments ? 'block' : 'none';
  if (hasInstallments) {
    const body = $('rInstallmentsBody');
    body.innerHTML = '';
    b.installments.forEach(i => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatMoney(i.amount)}</td><td>${i.dueDate || '-'}</td><td>${i.paid ? 'مدفوع' : 'غير مدفوع'}</td>`;
      body.appendChild(tr);
    });
  }

  $('rNotesWrap').style.display = b.notes ? 'block' : 'none';
  $('rNotes').textContent = b.notes || '';
  $('rPrintDate').textContent = new Date().toLocaleString('ar-EG');

  const hallLocation = (settings.hallLocation || '').trim();
  const locationWrap = $('rLocationWrap');
  if (hallLocation) {
    locationWrap.style.display = 'block';
    $('rLocationLink').textContent = hallLocation;
    try {
      $('rLocationQr').src = makeQRCodeDataURL(hallLocation, 160);
    } catch (err) {
      locationWrap.style.display = 'none';
    }
  } else {
    locationWrap.style.display = 'none';
  }

  showPrintPreview('printReceipt', 'معاينة إيصال الحجز', 'إيصال-' + (b.customerName || 'حجز') + '.pdf', b);
}

function getReceiptNumber(b) {
  const raw = (b.id || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return 'RC-' + (raw.slice(-6) || '000000');
}

// ---------------- Print Preview / Print / PDF Export ----------------
let previewElementId = null;
let previewFileName = 'مستند.pdf';
let previewBooking = null;

function showPrintPreview(elementId, title, fileName, booking) {
  previewElementId = elementId;
  previewFileName = fileName || 'مستند.pdf';
  previewBooking = booking || null;
  $('previewTitle').textContent = title || 'معاينة قبل الطباعة';
  $('previewContent').innerHTML = $(elementId).innerHTML;

  const canWhatsapp = !!(previewBooking && normalizePhoneForWhatsApp(previewBooking.phone));
  $('previewWhatsappBtn').style.display = canWhatsapp ? 'inline-block' : 'none';

  const printerName = settings.printerName;
  const printerLabel = printerName
    ? (availablePrinters.find(p => p.name === printerName)?.displayName || printerName)
    : 'طابعة النظام الافتراضية';
  $('previewPrinterHint').textContent = 'سيتم الطباعة على: ' + printerLabel;

  $('printPreviewModal').style.display = 'flex';
}

function closePrintPreview() {
  $('printPreviewModal').style.display = 'none';
  previewElementId = null;
  previewBooking = null;
}

$('closePreviewBtn').addEventListener('click', closePrintPreview);
$('printPreviewModal').addEventListener('click', (e) => {
  if (e.target.id === 'printPreviewModal') closePrintPreview();
});

$('previewWhatsappBtn').addEventListener('click', () => {
  if (!previewBooking) return;
  sendReceiptViaWhatsApp(previewBooking);
});

$('previewPrintBtn').addEventListener('click', async () => {
  if (!previewElementId) return;
  const btn = $('previewPrintBtn');
  btn.disabled = true;
  btn.textContent = 'جارِ الطباعة...';
  document.querySelectorAll('.print-only').forEach(el => el.classList.remove('active-print'));
  $(previewElementId).classList.add('active-print');

  if (window.api.printContent) {
    const result = await window.api.printContent({ printerName: settings.printerName || '' });
    $(previewElementId).classList.remove('active-print');
    btn.disabled = false;
    btn.textContent = 'طباعة';
    if (result && result.success) {
      closePrintPreview();
    } else {
      alert('تعذّرت الطباعة. تأكد من اتصال الطابعة وحاول مرة أخرى.');
    }
  } else {
    // Fallback for non-Electron preview
    window.print();
    $(previewElementId).classList.remove('active-print');
    btn.disabled = false;
    btn.textContent = 'طباعة';
  }
});

$('previewPdfBtn').addEventListener('click', async () => {
  if (!previewElementId) return;
  const btn = $('previewPdfBtn');
  btn.disabled = true;
  btn.textContent = 'جارِ التحويل...';
  document.querySelectorAll('.print-only').forEach(el => el.classList.remove('active-print'));
  $(previewElementId).classList.add('active-print');

  if (window.api.exportPDF) {
    const result = await window.api.exportPDF({ fileName: previewFileName });
    $(previewElementId).classList.remove('active-print');
    btn.disabled = false;
    btn.textContent = 'تحويل إلى PDF';
    if (result && result.success) {
      alert('تم حفظ الملف بنجاح في:\n' + result.filePath);
      closePrintPreview();
    } else if (!result || !result.canceled) {
      alert('تعذّر إنشاء ملف PDF. حاول مرة أخرى.');
    }
  } else {
    alert('لتحويل الملف إلى PDF، استخدم خيار "حفظ كـ PDF" من نافذة الطباعة.');
    window.print();
    $(previewElementId).classList.remove('active-print');
    btn.disabled = false;
    btn.textContent = 'تحويل إلى PDF';
  }
});

// ---------------- Helpers ----------------
function formatMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG') + ' د.ع';
}
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatProvider(type, name) {
  if (type === 'خارجي') return name || '-';
  return 'ضمن القاعة';
}

// init form defaults
resetForm();
