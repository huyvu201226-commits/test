// ============================================================
// admin.js — Logic trang quản trị
// Yêu cầu: data.js phải được nạp trước file này.
// Toàn bộ dữ liệu giờ lưu trên máy chủ (API), xác thực đăng nhập cũng thực hiện
// thật trên máy chủ (không còn kiểm tra mật khẩu ở trình duyệt).
// ============================================================

const STATUS_LABELS = {
    selling: { text: 'Đang bán', badge: 'badge-selling' },
    sold: { text: 'Đã bán', badge: 'badge-sold' },
    banned: { text: 'Bị ban (game khóa)', badge: 'badge-banned' },
    hacked: { text: 'Nghi ngờ hack - Đã khóa', badge: 'badge-hacked' }
};

document.addEventListener("DOMContentLoaded", async () => {
    if (isAdminLoggedIn()) {
        try {
            document.getElementById('adminLoginBox').style.display = 'none';
            await loadAdminData();
        } catch (err) {
            // token hết hạn/không hợp lệ -> apiFetch đã tự hiện lại màn đăng nhập
            console.error(err);
        }
    }

    // Event delegation cho bảng acc: 1 listener thay vì gắn onclick cho từng nút
    const tbody = document.getElementById('adminAccTableBody');
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

    // Event delegation cho bảng kho acc free
    const freeTbody = document.getElementById('adminFreeAccTableBody');
    if (freeTbody) {
        freeTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'edit-free') editFreeAccount(id);
            if (btn.dataset.action === 'delete-free') deleteFreeAccount(id);
        });
    }

    // Event delegation cho bảng Sự kiện
    const eventsTbody = document.getElementById('adminEventsTableBody');
    if (eventsTbody) {
        eventsTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            if (btn.dataset.action === 'edit-event') editEvent(id);
            if (btn.dataset.action === 'delete-event') deleteEventUI(id);
            if (btn.dataset.action === 'toggle-event') toggleEventUI(id);
        });
    }

    const rewardsContainer = document.getElementById('eventRewardsContainer');
    if (rewardsContainer) {
        addRewardRow(); // 1 dòng phần thưởng trống sẵn để tạo sự kiện mới
        rewardsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="remove-reward"]');
            if (!btn) return;
            btn.closest('.reward-row').remove();
        });
    }
});

async function updateAdminNavLogo() {
    const logoEl = document.getElementById('adminNavLogo');
    if (!logoEl) return;
    const settings = getSettings();
    logoEl.src = resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO);
}

async function verifyAdminPassword() {
    const pass = document.getElementById('adminPasswordInput').value;
    const msg = document.getElementById('loginMsg');
    msg.textContent = '';

    try {
        await adminLogin(pass);
        document.getElementById('adminLoginBox').style.display = 'none';
        await loadAdminData();
    } catch (err) {
        msg.textContent = 'Mật khẩu quản trị không chính xác!';
    }
}

async function logoutAdmin() {
    await adminLogout();
    location.reload();
}

async function loadAdminData() {
    await initAdminData();
    renderAdminAccounts();
    renderFreeAccounts();
    loadSettingsToForm();
    renderActivityLog();
    renderEventsAdmin();
    updateAdminNavLogo();
}

// ============================================================
// QUẢN LÝ TÀI KHOẢN (CRUD + khóa nhanh acc nghi hack)
// ============================================================
function renderAdminAccounts() {
    const accounts = getAccounts();
    const tbody = document.getElementById('adminAccTableBody');
    const fragment = document.createDocumentFragment();

    accounts.forEach((acc) => {
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

// Khóa nhanh 1 acc bị nghi hack (hoặc mở khóa lại về "Đang bán") ngay từ bảng,
// không cần mở form sửa đầy đủ.
async function toggleAccountLock(id) {
    const acc = getAccounts().find(a => a.id === id);
    if (!acc) return;

    let reason = '';
    if (acc.status !== 'hacked') {
        reason = prompt(`Ghi chú lý do khóa acc ${acc.code} (không bắt buộc):`, 'Phát hiện đăng nhập lạ / dấu hiệu bị hack') || '';
    }

    try {
        await toggleAccountLockApi(id, reason);
        renderAdminAccounts();
        renderActivityLog();
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
            imgField = await uploadFile(fileInput.files[0]);
        } else if (urlValue) {
            imgField = urlValue;
        } else if (isEdit) {
            const existing = getAccounts().find(a => a.id === editId);
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
            await updateAccount(editId, payload);
            document.getElementById('editIndex').value = -1;
        } else {
            await createAccount(payload);
        }
        document.getElementById('accForm').reset();
        clearAccImageUpload();
        renderAdminAccounts();
        renderActivityLog();
        alert('Lưu tài khoản thành công!');
    } catch (err) {
        alert('Lỗi khi lưu tài khoản: ' + err.message);
    }
}

function editAccount(id) {
    const acc = getAccounts().find(a => a.id === id);
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
    const acc = getAccounts().find(a => a.id === id);
    if (!acc) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản ${acc.code} không?`)) return;

    try {
        await deleteAccountApi(id);
        renderAdminAccounts();
        renderActivityLog();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}

function clearAccImageUpload() {
    const fileInput = document.getElementById('accImgFileInput');
    if (fileInput) fileInput.value = '';
}

// ============================================================
// KHO ACC FREE ("Quay Là Trúng") — quản lý danh sách acc dùng để tặng khi khách
// quay trúng (xác suất 1/1000/ngày/thiết bị).
// ============================================================
function renderFreeAccounts() {
    const accounts = getFreeAccounts();
    const tbody = document.getElementById('adminFreeAccTableBody');
    if (!tbody) return;

    if (accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="log-empty">Chưa có acc nào trong kho tặng.</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    accounts.forEach((acc) => {
        const tr = document.createElement('tr');
        const statusBadge = acc.claimed
            ? '<span class="badge-status badge-sold">Đã trao thưởng</span>'
            : '<span class="badge-status badge-selling">Còn trong kho</span>';
        tr.innerHTML = `
            <td><img class="admin-thumb" src="${escapeHtml(resolveMediaSrc(acc.img, DEFAULT_LOGO))}" alt="Ảnh ${escapeHtml(acc.code)}" loading="lazy"></td>
            <td><b>${escapeHtml(acc.code)}</b></td>
            <td>${escapeHtml(acc.name)}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn-sm btn-edit" data-id="${acc.id}" data-action="edit-free">Sửa</button>
                <button class="btn-sm btn-delete" data-id="${acc.id}" data-action="delete-free">Xóa</button>
            </td>
        `;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

async function saveFreeAccount(event) {
    event.preventDefault();
    const editId = parseInt(document.getElementById('freeEditIndex').value, 10);
    const isEdit = editId !== -1;

    const payload = {
        code: document.getElementById('freeCodeInput').value.trim(),
        name: document.getElementById('freeNameInput').value.trim(),
        info: document.getElementById('freeInfoInput').value.trim(),
        description: document.getElementById('freeDescInput').value.trim(),
        img: document.getElementById('freeImgInput').value.trim()
    };

    try {
        if (isEdit) {
            await updateFreeAccount(editId, payload);
            document.getElementById('freeEditIndex').value = -1;
        } else {
            await createFreeAccount(payload);
        }
        document.getElementById('freeAccForm').reset();
        renderFreeAccounts();
        renderActivityLog();
        alert('Lưu acc free thành công!');
    } catch (err) {
        alert('Lỗi khi lưu acc free: ' + err.message);
    }
}

function editFreeAccount(id) {
    const acc = getFreeAccounts().find(a => a.id === id);
    if (!acc) return;
    document.getElementById('freeEditIndex').value = acc.id;
    document.getElementById('freeCodeInput').value = acc.code;
    document.getElementById('freeNameInput').value = acc.name;
    document.getElementById('freeInfoInput').value = acc.info || '';
    document.getElementById('freeDescInput').value = acc.description || '';
    document.getElementById('freeImgInput').value = acc.img || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteFreeAccount(id) {
    const acc = getFreeAccounts().find(a => a.id === id);
    if (!acc) return;
    if (!confirm(`Xóa acc free ${acc.code} khỏi kho tặng?`)) return;

    try {
        await deleteFreeAccountApi(id);
        renderFreeAccounts();
        renderActivityLog();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}

// ============================================================
// NHẬT KÝ HOẠT ĐỘNG
// ============================================================
function renderActivityLog() {
    const tbody = document.getElementById('activityLogTableBody');
    if (!tbody) return;
    const logs = getActivityLog();

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="log-empty">Chưa có hoạt động nào được ghi nhận.</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    logs.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDateTime(entry.time)}</td>
            <td class="log-action">${escapeHtml(entry.action)}</td>
            <td>${escapeHtml(entry.detail)}</td>
        `;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

async function handleClearLog() {
    if (!confirm('Xóa toàn bộ nhật ký hoạt động?')) return;
    try {
        await clearActivityLogApi();
        renderActivityLog();
    } catch (err) {
        alert('Lỗi: ' + err.message);
    }
}

// ============================================================
// CẤU HÌNH HỆ THỐNG: thông tin chung, logo, avatar, nhạc, social links
// ============================================================
function loadSettingsToForm() {
    const settings = getSettings();
    const titleInput = document.getElementById('settingAdminTitle');
    if (!titleInput) return;

    titleInput.value = settings.adminTitle || '';
    document.getElementById('settingIntroText').value = settings.introText || '';
    document.getElementById('settingBankName').value = settings.bankName || '';
    document.getElementById('settingBankAcc').value = settings.bankAcc || '';
    document.getElementById('settingAudioUrl').value = settings.audioUrl || '';

    document.getElementById('settingSocialTiktok').value = settings.socialLinks.tiktok || '';
    document.getElementById('settingSocialYoutube').value = settings.socialLinks.youtube || '';
    document.getElementById('settingSocialZalo').value = settings.socialLinks.zalo || '';
    document.getElementById('settingSocialFacebook').value = settings.socialLinks.facebook || '';

    document.getElementById('logoPreview').src = resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO);
    document.getElementById('avatarPreview').src = resolveMediaSrc(settings.avatarUrl, DEFAULT_LOGO);

    const qrPreview = document.getElementById('qrPreview');
    if (qrPreview) {
        qrPreview.src = settings.qrImageUrl ? resolveMediaSrc(settings.qrImageUrl, '') : '';
        qrPreview.style.display = settings.qrImageUrl ? 'block' : 'none';
    }

    document.getElementById('settingLogoFile').value = '';
    document.getElementById('settingAvatarFile').value = '';
    document.getElementById('settingAudioFile').value = '';
    const qrFileInput = document.getElementById('settingQrFile');
    if (qrFileInput) qrFileInput.value = '';
}

async function saveGlobalSettings(event) {
    event.preventDefault();
    const payload = {
        adminTitle: document.getElementById('settingAdminTitle').value,
        introText: document.getElementById('settingIntroText').value,
        bankName: document.getElementById('settingBankName').value,
        bankAcc: document.getElementById('settingBankAcc').value,
        socialLinks: {
            tiktok: document.getElementById('settingSocialTiktok').value.trim(),
            youtube: document.getElementById('settingSocialYoutube').value.trim(),
            zalo: document.getElementById('settingSocialZalo').value.trim(),
            facebook: document.getElementById('settingSocialFacebook').value.trim()
        }
    };

    try {
        const logoFile = document.getElementById('settingLogoFile').files[0];
        if (logoFile) payload.logoUrl = await uploadFile(logoFile);

        const avatarFile = document.getElementById('settingAvatarFile').files[0];
        if (avatarFile) payload.avatarUrl = await uploadFile(avatarFile);

        const qrFileInput = document.getElementById('settingQrFile');
        const qrFile = qrFileInput ? qrFileInput.files[0] : null;
        if (qrFile) payload.qrImageUrl = await uploadFile(qrFile);

        const audioFile = document.getElementById('settingAudioFile').files[0];
        if (audioFile) {
            payload.audioUrl = await uploadFile(audioFile);
        } else {
            const urlValue = document.getElementById('settingAudioUrl').value.trim();
            if (urlValue) payload.audioUrl = urlValue;
        }

        await updateSettingsApi(payload);
        renderActivityLog();
        loadSettingsToForm();
        updateAdminNavLogo();
        alert('Đã cập nhật cấu hình hệ thống thành công!');
    } catch (err) {
        alert('Lỗi khi lưu cấu hình: ' + err.message);
    }
}

// Khôi phục 1 field ảnh/nhạc về rỗng (dùng ảnh/âm thanh mặc định của hệ thống)
async function resetMediaField(fieldName) {
    try {
        await updateSettingsApi({ [fieldName]: '' });
        renderActivityLog();
        loadSettingsToForm();
        updateAdminNavLogo();
    } catch (err) {
        alert('Lỗi: ' + err.message);
    }
}

// ============================================================
// ĐỔI MẬT KHẨU QUẢN TRỊ
// ============================================================
async function handleChangePassword(event) {
    event.preventDefault();
    const msg = document.getElementById('changePasswordMsg');
    msg.className = 'form-msg';
    msg.textContent = '';

    const current = document.getElementById('currentPasswordInput').value;
    const next = document.getElementById('newPasswordInput').value;
    const confirmNext = document.getElementById('confirmPasswordInput').value;

    if (next.length < 6) {
        msg.classList.add('error');
        msg.textContent = 'Mật khẩu mới phải có ít nhất 6 ký tự.';
        return;
    }
    if (next !== confirmNext) {
        msg.classList.add('error');
        msg.textContent = 'Xác nhận mật khẩu mới không khớp.';
        return;
    }

    try {
        await changeAdminPasswordApi(current, next);
        renderActivityLog();
        msg.classList.add('success');
        msg.textContent = 'Đổi mật khẩu thành công!';
        document.getElementById('changePasswordForm').reset();
    } catch (err) {
        msg.classList.add('error');
        msg.textContent = err.message || 'Mật khẩu hiện tại không đúng.';
    }
}

// ============================================================
// QUẢN LÝ SỰ KIỆN (mục 6) — mỗi sự kiện là 1 vòng quay độc lập với kho phần thưởng riêng.
// Khi tạo/bật hiển thị, sự kiện tự động xuất hiện ở trang Shop (banner) và trang
// "Quay Là Trúng" (vòng quay riêng) — xem renderShopEventBanners()/renderEventWheels() trong script.js.
// ============================================================
function renderEventsAdmin() {
    const tbody = document.getElementById('adminEventsTableBody');
    if (!tbody) return;
    const events = getEvents();

    if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="log-empty">Chưa có sự kiện nào được tạo.</td></tr>';
        return;
    }

    const fmt = (t) => t ? new Date(t).toLocaleString('vi-VN') : '—';
    const fragment = document.createDocumentFragment();
    events.forEach(ev => {
        const statusBadge = ev.status === 'hien'
            ? '<span class="badge-status badge-selling">Hiển thị</span>'
            : '<span class="badge-status badge-sold">Đang ẩn</span>';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${escapeHtml(ev.name)}</b><div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(EVENT_TYPE_LABELS[ev.type] || '')} · ${ev.rewards.length} phần thưởng</div></td>
            <td style="font-size:0.8rem;">${fmt(ev.startTime)}<br>đến ${fmt(ev.endTime)}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn-sm btn-edit" data-id="${ev.id}" data-action="edit-event">Sửa</button>
                <button class="btn-sm ${ev.status === 'hien' ? 'btn-lock' : 'btn-unlock'}" data-id="${ev.id}" data-action="toggle-event">${ev.status === 'hien' ? 'Ẩn' : 'Hiện'}</button>
                <button class="btn-sm btn-delete" data-id="${ev.id}" data-action="delete-event">Xóa</button>
            </td>
        `;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

function addRewardRow(reward) {
    const container = document.getElementById('eventRewardsContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'reward-row';
    row.dataset.rewardId = reward && reward.id ? reward.id : '';
    row.style.cssText = 'display:grid; grid-template-columns: 2fr 2fr 1fr 1fr auto; gap:8px; margin-bottom:8px; align-items:center;';
    row.innerHTML = `
        <input type="text" class="form-control reward-name" style="margin-bottom:0;" placeholder="Tên phần thưởng" value="${reward ? escapeHtml(reward.name) : ''}">
        <input type="url" class="form-control reward-image" style="margin-bottom:0;" placeholder="Link ảnh phần thưởng" value="${reward ? escapeHtml(reward.image || '') : ''}">
        <input type="number" class="form-control reward-odds" style="margin-bottom:0;" placeholder="Tỉ lệ %" step="0.01" min="0" max="100" value="${reward ? reward.odds : ''}">
        <input type="number" class="form-control reward-qty" style="margin-bottom:0;" placeholder="Số lượng" min="0" value="${reward ? reward.quantity : ''}">
        <button type="button" class="btn-sm btn-delete" data-action="remove-reward">Xóa</button>
    `;
    container.appendChild(row);
}

function resetEventForm() {
    document.getElementById('eventEditId').value = '';
    document.getElementById('eventForm').reset();
    document.getElementById('eventRewardsContainer').innerHTML = '';
    addRewardRow();
}

function editEvent(id) {
    const ev = getEvents().find(e => e.id === id);
    if (!ev) return;

    document.getElementById('eventEditId').value = ev.id;
    document.getElementById('eventNameInput').value = ev.name;
    document.getElementById('eventTypeInput').value = ev.type;
    document.getElementById('eventStatusInput').value = ev.status;
    document.getElementById('eventStartInput').value = ev.startTime ? ev.startTime.slice(0, 16) : '';
    document.getElementById('eventEndInput').value = ev.endTime ? ev.endTime.slice(0, 16) : '';
    document.getElementById('eventBannerInput').value = ev.banner || '';
    document.getElementById('eventDescInput').value = ev.description || '';

    const container = document.getElementById('eventRewardsContainer');
    container.innerHTML = '';
    if (ev.rewards.length === 0) addRewardRow();
    else ev.rewards.forEach(r => addRewardRow(r));

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEvent(event) {
    event.preventDefault();
    const editId = document.getElementById('eventEditId').value;
    const isEdit = !!editId;

    const rewardRows = Array.from(document.querySelectorAll('#eventRewardsContainer .reward-row'));
    const rewards = rewardRows.map(row => ({
        id: row.dataset.rewardId || undefined,
        name: row.querySelector('.reward-name').value.trim(),
        image: row.querySelector('.reward-image').value.trim(),
        odds: parseFloat(row.querySelector('.reward-odds').value) || 0,
        quantity: parseInt(row.querySelector('.reward-qty').value, 10) || 0
    })).filter(r => r.name);

    const payload = {
        name: document.getElementById('eventNameInput').value.trim(),
        type: document.getElementById('eventTypeInput').value,
        status: document.getElementById('eventStatusInput').value,
        startTime: document.getElementById('eventStartInput').value || null,
        endTime: document.getElementById('eventEndInput').value || null,
        banner: document.getElementById('eventBannerInput').value.trim(),
        description: document.getElementById('eventDescInput').value.trim(),
        rewards
    };

    try {
        const bannerFile = document.getElementById('eventBannerFileInput') ? document.getElementById('eventBannerFileInput').files[0] : null;
        if (bannerFile) payload.banner = await uploadFile(bannerFile);

        if (isEdit) await updateEventApi(editId, payload);
        else await createEventApi(payload);

        resetEventForm();
        renderEventsAdmin();
        renderActivityLog();
        alert('Lưu sự kiện thành công! Sự kiện sẽ tự động hiện/ẩn ở trang Shop và trang "Quay Là Trúng" theo trạng thái và thời gian đã đặt.');
    } catch (err) {
        alert('Lỗi khi lưu sự kiện: ' + err.message);
    }
}

async function toggleEventUI(id) {
    try {
        await toggleEventStatusApi(id);
        renderEventsAdmin();
        renderActivityLog();
    } catch (err) {
        alert('Lỗi: ' + err.message);
    }
}

async function deleteEventUI(id) {
    const ev = getEvents().find(e => e.id === id);
    if (!ev) return;
    if (!confirm(`Xóa sự kiện "${ev.name}"? Vòng quay sự kiện này sẽ biến mất khỏi trang khách ngay lập tức.`)) return;

    try {
        await deleteEventApi(id);
        renderEventsAdmin();
        renderActivityLog();
    } catch (err) {
        alert('Lỗi khi xóa: ' + err.message);
    }
}
