// إدارة قسم "الوصول عن بُعد" في تبويب الإعدادات
(function () {
  let publicPollTimer = null;

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

    renderPublicUI(info);
    renderNtfyUI(info);
  }

  function renderNtfyUI(info) {
    const linkEl = document.getElementById('ntfySubscribeLink');
    const qrWrap = document.getElementById('ntfyQrWrap');
    if (!linkEl) return;
    const topic = info.ntfyTopic || '';
    if (!topic) { linkEl.textContent = '—'; qrWrap.innerHTML = ''; return; }
    const subscribeUrl = `https://ntfy.sh/${topic}`;
    linkEl.textContent = subscribeUrl;
    qrWrap.innerHTML = '';
    try {
      const dataUrl = makeQRCodeDataURL(subscribeUrl, 160);
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'QR للاشتراك بالتنبيهات';
      img.className = 'remote-qr-img';
      qrWrap.appendChild(img);
    } catch (e) { /* ignore */ }
  }

  function renderPublicUI(info) {
    const publicToggle = document.getElementById('publicEnabledToggle');
    const publicStatusText = document.getElementById('publicStatusText');
    const publicDetails = document.getElementById('publicDetails');
    const publicUrlText = document.getElementById('publicUrlText');
    const publicQrWrap = document.getElementById('publicQrWrap');
    const publicErrorText = document.getElementById('publicErrorText');
    const publicDiagActions = document.getElementById('publicDiagActions');
    if (!publicToggle) return;

    publicToggle.disabled = !info.enabled;
    publicToggle.checked = !!info.publicEnabled;
    publicDetails.style.display = info.publicEnabled ? 'block' : 'none';
    publicErrorText.textContent = '';
    publicDiagActions.style.display = 'none';
    window.__lastRemoteInfo = info;

    if (!info.enabled) {
      publicStatusText.textContent = 'فعّل "الوصول عن بُعد" أولاً بالأعلى';
    } else if (!info.publicEnabled) {
      publicStatusText.textContent = 'غير مفعّل';
    } else if (info.publicStatus === 'ready' && info.publicUrl) {
      publicStatusText.textContent = 'مفعّل - جاهز';
      publicUrlText.textContent = info.publicUrl;
      publicQrWrap.innerHTML = '';
      try {
        const dataUrl = makeQRCodeDataURL(info.publicUrl, 180);
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'QR للرابط العام';
        img.className = 'remote-qr-img';
        publicQrWrap.appendChild(img);
      } catch (e) { /* ignore */ }
      stopPublicPolling();
    } else if (info.publicStatus === 'error') {
      publicStatusText.textContent = 'حصل خطأ';
      publicUrlText.textContent = '—';
      publicErrorText.textContent = (info.publicError || 'تعذر إنشاء الرابط العام.') + ' — لو استمر الفشل، استخدم بديل Radmin VPN الموضّح بالأعلى (موثوق ولا يعتمد على هذي الخدمة).';
      publicDiagActions.style.display = 'flex';
      stopPublicPolling();
    } else {
      publicStatusText.textContent = 'جارِ إنشاء الرابط... (قد يأخذ عدة ثوانٍ)';
      publicUrlText.textContent = 'جارِ الإنشاء...';
      startPublicPolling();
    }
  }

  function startPublicPolling() {
    if (publicPollTimer) return;
    publicPollTimer = setInterval(refreshRemoteInfo, 2000);
  }
  function stopPublicPolling() {
    if (publicPollTimer) { clearInterval(publicPollTimer); publicPollTimer = null; }
  }

  async function refreshRemoteInfo() {
    if (!window.api || !window.api.getRemoteInfo) return;
    const info = await window.api.getRemoteInfo();
    renderRemoteUI(info);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('remoteEnabledToggle');
    const regenBtn = document.getElementById('regenerateTokenBtn');
    const publicToggle = document.getElementById('publicEnabledToggle');
    const copyPublicBtn = document.getElementById('copyPublicLinkBtn');
    if (!toggle) return;

    toggle.addEventListener('change', async () => {
      const info = await window.api.setRemoteEnabled(toggle.checked);
      renderRemoteUI(info);
    });

    regenBtn.addEventListener('click', async () => {
      await window.api.regenerateRemoteToken();
      refreshRemoteInfo();
    });

    publicToggle.addEventListener('change', async () => {
      const info = await window.api.setPublicEnabled(publicToggle.checked);
      renderRemoteUI(info);
    });

    copyPublicBtn.addEventListener('click', () => {
      const url = document.getElementById('publicUrlText').textContent;
      if (!url || url.includes('جارِ')) return;
      navigator.clipboard.writeText(url);
      copyPublicBtn.textContent = 'تم النسخ ✓';
      setTimeout(() => { copyPublicBtn.textContent = 'نسخ'; }, 1500);
    });

    const copyNtfyBtn = document.getElementById('copyNtfyLinkBtn');
    const regenNtfyBtn = document.getElementById('regenerateNtfyBtn');
    copyNtfyBtn.addEventListener('click', () => {
      const url = document.getElementById('ntfySubscribeLink').textContent;
      if (!url || url === '—') return;
      navigator.clipboard.writeText(url);
      copyNtfyBtn.textContent = 'تم النسخ ✓';
      setTimeout(() => { copyNtfyBtn.textContent = 'نسخ'; }, 1500);
    });
    regenNtfyBtn.addEventListener('click', async () => {
      await window.api.regenerateNtfyTopic();
      refreshRemoteInfo();
    });

    const copyDiagBtn = document.getElementById('copyDiagLogBtn');
    const testConnBtn = document.getElementById('testConnectivityBtn');
    if (copyDiagBtn) {
      copyDiagBtn.addEventListener('click', () => {
        const info = window.__lastRemoteInfo || {};
        const text = 'رسالة الخطأ:\n' + (info.publicError || '-') + '\n\nسجل التشخيص الخام:\n' + (info.publicDiagLog || '(فارغ)');
        navigator.clipboard.writeText(text);
        copyDiagBtn.textContent = 'تم النسخ ✓';
        setTimeout(() => { copyDiagBtn.textContent = '📋 نسخ سجل التشخيص'; }, 1500);
      });
    }
    if (testConnBtn) {
      testConnBtn.addEventListener('click', async () => {
        const resultEl = document.getElementById('connectivityResultText');
        testConnBtn.disabled = true;
        testConnBtn.textContent = 'جارِ الفحص...';
        resultEl.textContent = '';
        try {
          const results = await window.api.testRemoteConnectivity();
          resultEl.innerHTML = results.map(r => {
            const icon = r.ok ? '✅' : '❌';
            const detail = r.ok ? (r.ms + ' مللي ثانية') : (r.error || 'فشل');
            return icon + ' ' + r.name + ': ' + detail;
          }).join('<br>');
        } catch (e) {
          resultEl.textContent = 'تعذر تنفيذ الفحص.';
        } finally {
          testConnBtn.disabled = false;
          testConnBtn.textContent = '🔎 فحص الاتصال بالإنترنت';
        }
      });
    }

    if (window.api.onRemotePublicReady) {
      window.api.onRemotePublicReady(() => refreshRemoteInfo());
    }

    refreshRemoteInfo();
  });
})();
