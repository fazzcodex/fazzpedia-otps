// DOM Elements
const hamburger = document.getElementById('hamburgerBtn');
const sidebar = document.getElementById('sidebar');
const closeSidebar = document.getElementById('closeSidebar');
const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');

// Sidebar toggle
function toggleSidebar() {
    sidebar.classList.toggle('open');
}
hamburger?.addEventListener('click', toggleSidebar);
closeSidebar?.addEventListener('click', toggleSidebar);
document.addEventListener('click', (e) => {
    if (sidebar?.classList.contains('open') && !sidebar.contains(e.target) && !hamburger?.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// Navigation
function navigateTo(pageId) {
    pages.forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(`${pageId}-page`);
    if (targetPage) targetPage.classList.add('active');
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === pageId) link.classList.add('active');
    });
    localStorage.setItem('lastPage', pageId);
    if (pageId === 'stats') loadBotStats();
    if (pageId === 'history') refreshHistory();
}
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        navigateTo(page);
        if (window.innerWidth < 768) toggleSidebar();
    });
});
const lastPage = localStorage.getItem('lastPage');
if (lastPage && ['home','order','history','stats','deposit','settings'].includes(lastPage)) {
    navigateTo(lastPage);
} else {
    navigateTo('home');
}

// Quick order button
document.getElementById('quickOrderBtn')?.addEventListener('click', () => {
    navigateTo('order');
    if (window.innerWidth < 768) toggleSidebar();
});
document.getElementById('refreshBtn')?.addEventListener('click', () => location.reload());

// ========== ORDER LOGIC ==========
const serviceSelect = document.getElementById('serviceSelect');
const countrySelect = document.getElementById('countrySelect');
const operatorSelect = document.getElementById('operatorSelect');
const orderBtn = document.getElementById('orderBtn');
let selectedCountryData = null;

serviceSelect.addEventListener('change', async () => {
    const serviceId = serviceSelect.value;
    if (!serviceId) return;
    countrySelect.disabled = true;
    countrySelect.innerHTML = '<option>Loading...</option>';
    try {
        const res = await fetch(`/api/countries/${serviceId}`);
        const data = await res.json();
        if (data.success) {
            countrySelect.innerHTML = '<option value="">-- Pilih Negara --</option>';
            data.countries.forEach(c => {
                const provider = c.pricelist[0];
                const price = Math.ceil(provider.price * 1.2);
                const option = document.createElement('option');
                option.value = JSON.stringify({
                    numberId: c.number_id,
                    providerId: provider.provider_id,
                    originalPrice: provider.price,
                    countryName: c.name,
                    prefix: c.prefix
                });
                option.textContent = `${c.name} (${c.prefix}) - Rp ${price.toLocaleString()}`;
                countrySelect.appendChild(option);
            });
            countrySelect.disabled = false;
        } else {
            countrySelect.innerHTML = '<option>Gagal load</option>';
        }
    } catch(e) { countrySelect.innerHTML = '<option>Error</option>'; }
});

countrySelect.addEventListener('change', async () => {
    const val = countrySelect.value;
    if (!val) return;
    selectedCountryData = JSON.parse(val);
    operatorSelect.disabled = true;
    operatorSelect.innerHTML = '<option>Loading...</option>';
    const res = await fetch(`/api/operators?countryName=${encodeURIComponent(selectedCountryData.countryName)}&providerId=${selectedCountryData.providerId}`);
    const data = await res.json();
    if (data.success && data.operators.length) {
        operatorSelect.innerHTML = '';
        data.operators.forEach(op => {
            const opt = document.createElement('option');
            opt.value = op.id;
            opt.textContent = op.name;
            operatorSelect.appendChild(opt);
        });
        operatorSelect.disabled = false;
        orderBtn.disabled = false;
    } else {
        operatorSelect.innerHTML = '<option value="1">any</option>';
        operatorSelect.disabled = false;
        orderBtn.disabled = false;
    }
});

document.getElementById('orderForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedCountryData) return;
    const operatorId = operatorSelect.value;
    const serviceName = serviceSelect.options[serviceSelect.selectedIndex]?.text;
    orderBtn.disabled = true;
    orderBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Processing...';
    const payload = {
        numberId: selectedCountryData.numberId,
        providerId: selectedCountryData.providerId,
        operatorId,
        serviceName,
        countryName: selectedCountryData.countryName,
        originalPrice: selectedCountryData.originalPrice
    };
    const res = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (result.success) {
        document.getElementById('orderResult').innerHTML = `<div style="color:var(--success)">Order berhasil! Order ID: ${result.orderId}<br>Nomor: ${result.phoneNumber}<br>Saldo telah dipotong.</div>`;
        refreshBalanceAndHistory();
    } else {
        document.getElementById('orderResult').innerHTML = `<div style="color:var(--danger)"> Gagal: ${result.error}</div>`;
    }
    orderBtn.disabled = false;
    orderBtn.innerHTML = '<i class="fas fa-cart-plus"></i> Pesan Sekarang';
});

// ========== TOPUP ==========
document.getElementById('topupBtn')?.addEventListener('click', async () => {
    const amount = parseInt(document.getElementById('topupAmount').value);
    if (!amount || amount < 1000) { alert('Minimal Rp1000'); return; }
    const res = await fetch('/api/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) });
    const data = await res.json();
    if (data.success) {
        let html = `<div>QRIS generated. Scan kode:</div><img src="${data.qrImage}" style="max-width:180px; margin:10px auto; display:block;"><div>ID: ${data.depositId}</div>`;
        html += `<button onclick="checkTopup('${data.depositId}')" class="btn btn-secondary" style="margin-top:10px;"><i class="fas fa-check"></i> Cek Pembayaran</button>`;
        document.getElementById('topupResult').innerHTML = html;
    } else {
        document.getElementById('topupResult').innerHTML = `<div style="color:var(--danger)"> ${data.error}</div>`;
    }
});
window.checkTopup = async (depositId) => {
    const res = await fetch(`/api/topup-status/${depositId}`);
    const data = await res.json();
    if (data.success && data.status === 'success') {
        alert(`Topup berhasil! +Rp ${data.amount.toLocaleString()}`);
        refreshBalanceAndHistory();
        document.getElementById('topupResult').innerHTML = '';
    } else {
        alert(`Status: ${data.status || 'pending'}. Belum terdeteksi.`);
    }
};

// ========== STATS ==========
async function loadBotStats() {
    const container = document.getElementById('botStats');
    container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-pulse"></i> Memuat...</div>';
    try {
        const res = await fetch('/api/bot-stats');
        const data = await res.json();
        let html = '';
        for (const [key, val] of Object.entries(data)) {
            let label = key.replace(/([A-Z])/g, ' $1').trim();
            html += `<div class="stat-card"><div class="stat-icon"><i class="fas fa-chart-simple"></i></div><div class="stat-info"><h3>${label}</h3><p>${val}</p></div></div>`;
        }
        container.innerHTML = html;
    } catch(e) { container.innerHTML = '<div class="error">Gagal memuat statistik</div>'; }
}

// ========== HISTORY ==========
async function refreshHistory() {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '<tr><td colspan="7"><i class="fas fa-spinner fa-pulse"></i> Memuat...</td></tr>';
    const res = await fetch('/api/user-orders');
    const data = await res.json();
    if (data.success && data.orders.length) {
        let rows = '';
        data.orders.forEach(o => {
            rows += `<tr class="status-${o.status}">
                        <td><code>${o.order_id}</code></td>
                        <td>${o.phone_number || '-'}</td>
                        <td>${o.service}</td>
                        <td>${o.country}</td>
                        <td><span class="badge ${o.status}">${o.status.toUpperCase()}</span></td>
                        <td>Rp ${(o.price || 0).toLocaleString()}</td>
                        <td>${new Date(o.created_at).toLocaleString()}</td>
                     </tr>`;
        });
        tbody.innerHTML = rows;
    } else {
        tbody.innerHTML = '<tr><td colspan="7">Belum ada order</td></tr>';
    }
}
document.getElementById('refreshHistoryBtn')?.addEventListener('click', refreshHistory);

// ========== SETTINGS & THEME ==========
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }
}
document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    const notif = document.getElementById('notifToggle').checked;
    const language = document.getElementById('languageSelect').value;
    const theme = document.getElementById('themeSelect').value;
    localStorage.setItem('notifEnabled', notif);
    localStorage.setItem('language', language);
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    alert('Pengaturan disimpan');
});
const savedTheme = localStorage.getItem('theme');
if (savedTheme) applyTheme(savedTheme);
if (localStorage.getItem('notifEnabled') === 'false') document.getElementById('notifToggle').checked = false;
if (localStorage.getItem('language')) document.getElementById('languageSelect').value = localStorage.getItem('language');

// ========== HELPER ==========
async function refreshBalanceAndHistory() {
    const userRes = await fetch('/api/user-info');
    const userData = await userRes.json();
    if (userData.balance !== undefined) {
        const balanceFormatted = `Rp ${userData.balance.toLocaleString()}`;
        document.getElementById('homeBalance').innerText = balanceFormatted;
        document.getElementById('topBalance').innerText = balanceFormatted;
        const sidebarBalance = document.querySelector('.user-balance');
        if (sidebarBalance) sidebarBalance.innerText = balanceFormatted;
    }
    refreshHistory();
}
// ==================== RIWAYAT DEPOSIT ====================
async function loadDepositHistory() {
    const tbody = document.getElementById('depositHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4"><i class="fas fa-spinner fa-pulse"></i> Memuat...</td></tr>';
    try {
        const res = await fetch('/api/deposits');
        const data = await res.json();
        if (data.success && data.deposits.length) {
            let rows = '';
            data.deposits.forEach(d => {
                let statusClass = 'pending';
                let statusText = d.status.toUpperCase();
                if (d.status === 'success') statusClass = 'completed';
                if (d.status === 'canceled') statusClass = 'canceled';
                const statusBadge = `<span class="badge ${statusClass}">${statusText}</span>`;
                rows += `<tr>
                            <td><code>${d.id}</code></td>
                            <td>Rp ${(d.amount || 0).toLocaleString()}</td>
                            <td>${statusBadge}</td>
                            <td>${new Date(d.created_at).toLocaleString()}</td>
                         </tr>`;
            });
            tbody.innerHTML = rows;
        } else {
            tbody.innerHTML = '<tr><td colspan="4">Belum ada deposit</td></tr>';
        }
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="4">Gagal memuat riwayat</td></tr>';
    }
}

// Panggil loadDepositHistory saat halaman deposit aktif
if (document.getElementById('deposit-page')) {
    const depositObserver = new MutationObserver(() => {
        if (document.getElementById('deposit-page').classList.contains('active')) {
            loadDepositHistory();
        }
    });
    depositObserver.observe(document.getElementById('deposit-page'), { attributes: true });
    if (document.getElementById('deposit-page').classList.contains('active')) loadDepositHistory();
}

// Update fungsi topup dengan tampilan QRIS profesional
const originalTopupBtnHandler = async () => {
    const amount = parseInt(document.getElementById('topupAmount').value);
    if (!amount || amount < 1000) { alert('Minimal Rp1000'); return; }
    const res = await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
    });
    const data = await res.json();
    if (data.success) {
        let html = `
            <div class="qris-container" style="text-align:center;">
                <p><i class="fas fa-check-circle" style="color:var(--success); font-size:1.2rem;"></i> <strong>QRIS berhasil dibuat!</strong></p>
                <img src="${data.qrImage}" style="max-width:220px; margin:15px auto; display:block; border-radius:16px; border:1px solid var(--border); box-shadow:var(--shadow-sm);">
                <div style="background:#f8fafc; padding:10px; border-radius:12px; margin:10px 0; display:inline-block;">
                    <small>ID Deposit: <strong style="font-family:monospace;">${data.depositId}</strong></small>
                    <button class="btn-icon" onclick="copyToClipboard('${data.depositId}')" style="margin-left:8px;"><i class="fas fa-copy"></i></button>
                </div>
                <p><small>Scan QRIS di atas atau gunakan ID deposit untuk pembayaran.</small></p>
                <button onclick="checkTopup('${data.depositId}')" class="btn btn-secondary" style="margin-top:10px;"><i class="fas fa-sync-alt"></i> Cek Pembayaran</button>
            </div>
        `;
        document.getElementById('topupResult').innerHTML = html;
    } else {
        document.getElementById('topupResult').innerHTML = `<div style="color:var(--danger)"> ${data.error}</div>`;
    }
};

// Ganti event listener topupBtn
const topupBtn = document.getElementById('topupBtn');
if (topupBtn) {
    // Hapus event listener lama jika ada
    const newBtn = topupBtn.cloneNode(true);
    topupBtn.parentNode.replaceChild(newBtn, topupBtn);
    newBtn.addEventListener('click', originalTopupBtnHandler);
}

// Fungsi copy to clipboard
window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert(' ID Deposit disalin ke clipboard!');
};

// Update fungsi checkTopup agar refresh riwayat deposit setelah sukses
window.checkTopup = async (depositId) => {
    const res = await fetch(`/api/topup-status/${depositId}`);
    const data = await res.json();
    if (data.success && data.status === 'success') {
        alert(` Topup berhasil! +Rp ${data.amount.toLocaleString()}`);
        // Refresh balance dan history
        refreshBalanceAndHistory();
        loadDepositHistory();
        document.getElementById('topupResult').innerHTML = '';
    } else {
        alert(` Status: ${data.status || 'pending'}. Belum terdeteksi pembayaran.`);
    }
};
// Fungsi cancel deposit
async function cancelDeposit(depositId) {
    if (!confirm('Yakin ingin membatalkan deposit ini? Deposit yang dibatalkan tidak dapat diproses.')) return;
    try {
        const res = await fetch(`/api/cancel-deposit/${depositId}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert('✅ Deposit berhasil dibatalkan');
            loadDepositHistory(); // refresh tabel
        } else {
            alert('❌ Gagal: ' + data.error);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Load riwayat deposit dengan tombol cancel
async function loadDepositHistory() {
    const tbody = document.getElementById('depositHistoryBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5"><i class="fas fa-spinner fa-pulse"></i> Memuat...</td></tr>';
    try {
        const res = await fetch('/api/deposits');
        const data = await res.json();
        if (data.success && data.deposits.length) {
            let rows = '';
            data.deposits.forEach(d => {
                let statusClass = 'pending';
                let statusText = d.status.toUpperCase();
                if (d.status === 'success') statusClass = 'completed';
                if (d.status === 'canceled') statusClass = 'canceled';
                const statusBadge = `<span class="badge ${statusClass}">${statusText}</span>`;
                let actionButton = '';
                if (d.status === 'pending') {
                    actionButton = `<button class="btn-icon" onclick="cancelDeposit('${d.id}')" title="Batalkan"><i class="fas fa-times-circle" style="color:var(--danger);"></i></button>`;
                } else {
                    actionButton = '-';
                }
                rows += `<tr>
                            <td><code>${d.id}</code></td>
                            <td>Rp ${(d.amount || 0).toLocaleString()}</td>
                            <td>${statusBadge}</td>
                            <td>${new Date(d.created_at).toLocaleString()}</td>
                            <td>${actionButton}</td>
                         </tr>`;
            });
            tbody.innerHTML = rows;
        } else {
            tbody.innerHTML = '<tr><td colspan="5">Belum ada deposit</td></tr>';
        }
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="5">Gagal memuat riwayat</td></tr>';
    }
}
// Refresh on page load if home visible
if (document.getElementById('home-page')?.classList.contains('active')) refreshBalanceAndHistory();