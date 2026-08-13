// إدارة قسم "الوصول عن بُعد" في تبويب الإعدادات
(function () {
  function renderRemoteUI(info) {
    const toggle = document.getElementById('remoteEnabledToggle');
    const statusText = document.getElementById('remoteStatusText');
    const details = document.getElementById('remoteDetails');
    const linksList = document.getElementById('remoteLinksList');
    const tokenDisplay = document.getElementById('remoteTokenDisplay');
    const qrWrap = document.getElementById('remoteQrWrap');
    if (!toggle) return;

    toggle.checked = !!info.enabled;
    statusText.textContent = info.enabled ? (info.running ? 'مفعّل ويعمل الآن' : 'مفعّل - جارِ التشغيل...') : 'غير مفعّل';
    details.style.display = info.enabled ? 'block' : 'none';
    tokenDisplay.value = info.token || '';

    const ips = (info.localIPs && info.localIPs.length) ? info.localIPs : [];
    if (ips.length === 0) {
      linksList.innerHTML = '<div class="remote-link-item">لم يتم العثور على عنوان شبكة. تأكد من اتصال الجهاز بشبكة (محلية أو Radmin VPN).</div>';
    } else {
      linksList.innerHTML = ips.map(ip => {
        const url = `http://${ip}:${info.port}/?token=${encodeURIComponent(info.token)}`;
        return `<div class="remote-link-item"><code>${url}</code><button type="button" class="btn btn-light btn-small copy-link-btn" data-url="${url}">نسخ</button></div>`;
      }).join('');
      linksList.querySelectorAll('.copy-link-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(btn.dataset.url);
          btn.textContent = 'تم النسخ ✓';
          setTimeout(() => { btn.textContent = 'نسخ'; }, 1500);
        });
      });
    }

    qrWrap.innerHTML = '';
    if (ips.length > 0 && info.enabled) {
      const primaryUrl = `http://${ips[0]}:${info.port}/?token=${encodeURIComponent(info.token)}`;
      try {
        const dataUrl = makeQRCodeDataURL(primaryUrl, 180);
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'QR للوصول عن بُعد';
        img.className = 'remote-qr-img';
        const label = document.createElement('p');
        label.className = 'field-hint';
        label.textContent = 'امسح الرمز من تطبيق الأندرويد أو المتصفح لفتح رابط العرض مباشرة';
        qrWrap.appendChild(img);
        qrWrap.appendChild(label);
      } catch (e) { /* ignore QR errors */ }
    }
  }

  async function refreshRemoteInfo() {
    if (!window.api || !window.api.getRemoteInfo) return;
    const info = await window.api.getRemoteInfo();
    renderRemoteUI(info);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('remoteEnabledToggle');
    const regenBtn = document.getElementById('regenerateTokenBtn');
    if (!toggle) return;

    toggle.addEventListener('change', async () => {
      const info = await window.api.setRemoteEnabled(toggle.checked);
      renderRemoteUI(info);
    });

    regenBtn.addEventListener('click', async () => {
      await window.api.regenerateRemoteToken();
      refreshRemoteInfo();
    });

    refreshRemoteInfo();
  });
})();
