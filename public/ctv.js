// ============================================================
// ctv.js — Logic trang riêng dành cho Cộng Tác Viên (CTV)
// Yêu cầu: data.js phải được nạp trước file này (dùng chung formatVND,
// escapeHtml, resolveMediaSrc, ACCOUNT_TYPE_LABELS...).
// CTV có phiên đăng nhập RIÊNG (token role 'ctv'), tách biệt hoàn toàn với
// phiên Admin (jh_admin_token) — 2 trang có thể đăng nhập cùng lúc trên
// cùng 1 trình duyệt mà không ảnh hưởng nhau.
// ============================================================

const STATUS_LABELS = {
    selling: { text: 'Đang bán', badge: 'badge-selling' },
    sold: { text: 'Đã bán', badge: 'badge-sold' },
    banned: { text: 'Bị ban (game khóa)', badge: 'badge-banned' },
    hacked: { text: 'Nghi ngờ hack - Đã khóa', badge: 'badge-hacked' }
};

const CTV_REMEMBER_KEY = 'jh_ctv_remember';

let _ctvAccountsCache = [];

// ------------------------------------------------------------
// Token & phiên đăng nhập CTV — nếu chọn "Ghi nhớ đăng nhập" thì lưu token vào
// localStorage (tồn tại qua các lần đóng/mở trình duyệt), ngược lại lưu ở
// sessionStorage (mất khi đóng tab), giống cách trình duyệt xử lý "remember me".
// ------------------------------------------------------------
function getCtvToken() {
    return localStorage.getItem('jh_ctv_token') || sessionStorage.getItem('jh_ctv_token');
}
function setCtvToken(token, remember) {
    localStorage.removeItem('jh_ctv_token');
    sessionStorage.removeItem('jh_ctv_token');
    if (!token) return;
    if (remember) localStorage.setItem('jh_ctv_token', token);
    else sessionStorage.setItem('jh_ctv_token', token);
}
function isCtvLoggedIn() { return !!getCtvToken(); }

async function ctvApiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getCtvToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (res.status === 401 && path !== '/api/collaborator/login') {
        setCtvToken(null);
        const loginBox = document.getElementById('ctvLoginBox');
        if (loginBox) {
            loginBox.style.display = 'flex';
            const msg = document.getElementById('ctvLoginMsg');
            if (msg) msg.textContent = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';
        }
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* phản hồi rỗng, bỏ qua */ }
    if (!res.ok) throw new Error((data && data.error) || `Lỗi máy chủ (${res.status})`);
    return data;
}

async function ctvUploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const token = getCtvToken();
    const res = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || 'Tải tệp lên thất bại.');
    return data.url;
}

// ------------------------------------------------------------
// Ghi nhớ đăng nhập: lưu sẵn tên đăng nhập (không lưu mật khẩu) để lần sau tự
// điền vào ô, người dùng chỉ cần bấm Đăng Nhập nếu phiên trước đó còn hiệu lực,
// hoặc gõ lại mật khẩu nếu phiên đã hết hạn.
// ------------------------------------------------------------
function prefillRememberedUsername() {
    const remembered = localStorage.getItem(CTV_REMEMBER_KEY);
    if (remembered) {
        document.getElementById('ctvLoginUsername').value = remembered;
        document.getElementById('ctvRememberMe').checked = true;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    prefillRememberedUsername();

    if (isCtvLoggedIn()) {
        try {
            document.getElementById('ctvLoginBox').style.display = 'none';
            await loadCtvData();
        } catch (err) {
            console.error(err);
        }
    }

    const tbody = document.getElementById('ctvAccTableBody');
    if (tbody) {
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'edit') editAccount(id);
            if (btn.dataset.action === 'delete') deleteAccount(id);
            if (btn.dataset.action === 'toggle-lock') toggleAccountLock(id);
        });
    }

    // Cho phép nhấn Enter ở ô mật khẩu để đăng nhập nhanh
    const pwInput = document.getElementById('ctvLoginPassword');
    if (pwInput) pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCtvLogin(); });
});

async function handleCtvLogin() {
    const username = document.getElementById('ctvLoginUsername').value.trim();
    const password = document.getElementById('ctvLoginPassword').value;
    const remember = document.getElementById('ctvRememberMe').checked;
    const msg = document.getElementById('ctvLoginMsg');
    msg.textContent = '';

    try {
        const data = await ctvApiFetch('/api/collaborator/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        setCtvToken(data.token, remember);

        if (remember) localStorage.setItem(CTV_REMEMBER_KEY, username);
        else localStorage.removeItem(CTV_REMEMBER_KEY);

        document.getElementById('ctvLoginBox').style.display = 'none';
        await loadCtvData();
    } catch (err) {
        msg.textContent = 'Sai tài khoản hoặc mật khẩu!';
    }
}

async function logoutCtv() {
    try { await ctvApiFetch('/api/collaborator/logout', { method: 'POST' }); } catch (e) { /* phiên có thể đã hết hạn, bỏ qua */ }
    setCtvToken(null);
    location.reload();
}

async function loadCtvData() {
    const state = await ctvApiFetch('/api/collaborator/state');
    _ctvAccountsCache = state.accounts;
    const who = document.getElementById('ctvWhoAmI');
    if (who) who.innerHTML = `<i class="fa-solid fa-circle-user"></i> Xin chào, ${escapeHtml(state.username || 'CTV')}`;
    renderCtvAccounts();
}

// ============================================================
// QUẢN LÝ TÀI KHOẢN (CRUD + khóa nhanh acc nghi hack) — CHỈ mục này CTV được quyền
// ============================================================
function renderCtvAccounts() {
    const tbody = document.getElementById('ctvAccTableBody');
    const fragment = document.createDocumentFragment();

    _ctvAccountsCache.forEach((acc) => {
        const statusInfo = STATUS_LABELS[acc.status] || STATUS_LABELS.selling;
        const typeInfo = ACCOUNT_TYPE_LABELS[acc.type] || ACCOUNT_TYPE_LABELS.reg;
        const isHacked = acc.status === 'hacked';
        const lockBtnClass = isHacked ? 'btn-unlock' : 'btn-lock';
        const lockBtnLabel = isHacked ? 'Mở Khóa' : 'Khóa (Nghi Hack)';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img class="admin-thumb" src="${escapeHtml(resolveMediaSrc(acc.img, 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300'))}" alt="Ảnh ${escapeHtml(acc.code)}" loading="lazy"></td>
            <td><b>${escapeHtml(acc.code)}</b></td>
            <td>${escapeHtml(acc.name)}</td>
            <td><span class="badge-status ${typeInfo.badge}">${typeInfo.text}</span></td>
            <td>${formatVND(acc.price)}</td>
            <td><span class="badge-status ${statusInfo.badge}">${statusInfo.text}</span></td>
            <td>
                <button class="btn-sm btn-edit" data-id="${acc.id}" data-action="edit">Sửa</button>
                <button class="btn-sm ${lockBtnClass}" data-id="${acc.id}" data-action="toggle-lock">${lockBtnLabel}</button>
                <button class="btn-sm btn-delete" data-id="${acc.id}" data-action="delete">Xóa</button>
            </td>
        `;
        fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

async function toggleAccountLock(id) {
    const acc = _ctvAccountsCache.find(a => a.id === id);
    if (!acc) return;

    let reason = '';
    if (acc.status !== 'hacked') {
        reason = prompt(`Ghi chú lý do khóa acc ${acc.code} (không bắt buộc):`, 'Phát hiện đăng nhập lạ / dấu hiệu bị hack') || '';
    }

    try {
        const updated = await ctvApiFetch(`/api/accounts/${id}/lock`, { method: 'PUT', body: JSON.stringify({ reason }) });
        const idx = _ctvAccountsCache.findIndex(a => a.id === id);
        if (idx !== -1) _ctvAccountsCache[idx] = updated;
        renderCtvAccounts();
    } catch (err) {
        alert('Lỗi: ' + err.message);
    }
}

async function saveAccount(event) {
    event.preventDefault();
    const editId = parseInt(document.getElementById('editIndex').value, 10);
    const isEdit = editId !== -1;
    const fileInput = document.getElementById('accImgFileInput');
    const urlValue = document.getElementById('accImgInput').value.trim();

    let imgField;
    try {
        if (fileInput.files && fileInput.files[0]) {
            imgField = await ctvUploadFile(fileInput.files[0]);
        } else if (urlValue) {
            imgField = urlValue;
        } else if (isEdit) {
            const existing = _ctvAccountsCache.find(a => a.id === editId);
            imgField = existing ? existing.img : '';
        } else {
            imgField = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300';
        }
    } catch (err) {
        alert('Tải ảnh lên thất bại: ' + err.message);
        return;
    }

    const payload = {
        code: document.getElementById('accCodeInput').value.trim(),
        name: document.getElementById('accNameInput').value.trim(),
        info: document.getElementById('accInfoInput').value.trim(),
        description: document.getElementById('accDescInput').value.trim(),
        price: parseFloat(document.getElementById('accPriceInput').value),
        category: document.getElementById('accCategoryInput').value,
        type: document.getElementById('accTypeInput').value,
        status: document.getElementById('accStatusInput').value,
        img: imgField
    };

    try {
        if (isEdit) {
            const updated = await ctvApiFetch(`/api/accounts/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
            const idx = _ctvAccountsCache.findIndex(a => a.id === editId);
            if (idx !== -1) _ctvAccountsCache[idx] = updated;
            document.getElementById('editIndex').value = -1;
        } else {
            const created = await ctvApiFetch('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
            _ctvAccountsCache.unshift(created);
        }
        document.getElementById('accForm').reset();
        clearAccImageUpload();
        renderCtvAccounts();
        alert('Lưu tài khoản thành công!');
    } catch (err) {
        alert('Lỗi khi lưu tài khoản: ' + err.message);
    }
}

function editAccount(id) {
    const acc = _ctvAccountsCache.find(a => a.id === id);
    if (!acc) return;

    document.getElementById('editIndex').value = acc.id;
    document.getElementById('accCodeInput').value = acc.code;
    document.getElementById('accNameInput').value = acc.name;
    document.getElementById('accInfoInput').value = acc.info || '';
    document.getElementById('accDescInput').value = acc.description || '';
    document.getElementById('accPriceInput').value = acc.price;
    document.getElementById('accCategoryInput').value = acc.category;
    document.getElementById('accTypeInput').value = acc.type || 'reg';
    document.getElementById('accStatusInput').value = acc.status;
    document.getElementById('accImgInput').value = acc.img || '';
    clearAccImageUpload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteAccount(id) {
    const acc = _ctvAccountsCache.find(a => a.id === id);
    if (!acc) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản ${acc.code} không?`)) return;

    try {
        await ctvApiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
        _ctvAccountsCache = _ctvAccountsCache.filter(a => a.id !== id);
        renderCtvAccounts();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}

function clearAccImageUpload() {
    const fileInput = document.getElementById('accImgFileInput');
    if (fileInput) fileInput.value = '';
}
