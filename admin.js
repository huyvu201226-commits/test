// ============================================================
// admin.js — Logic trang quản trị (đã tối ưu + mở rộng tính năng)
// Yêu cầu: data.js phải được nạp trước file này.
// ============================================================

const STATUS_LABELS = {
    selling: { text: 'Đang bán', badge: 'badge-selling' },
    sold: { text: 'Đã bán', badge: 'badge-sold' },
    banned: { text: 'Bị ban (game khóa)', badge: 'badge-banned' },
    hacked: { text: 'Nghi ngờ hack - Đã khóa', badge: 'badge-hacked' }
};

document.addEventListener("DOMContentLoaded", () => {
    if (sessionStorage.getItem('jh_admin_logged') === 'true') {
        document.getElementById('adminLoginBox').style.display = 'none';
        loadAdminData();
    }
    updateAdminNavLogo();

    // Event delegation cho bảng acc: 1 listener thay vì gắn onclick cho từng nút
    const tbody = document.getElementById('adminAccTableBody');
    if (tbody) {
        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const index = Number(btn.dataset.index);
            if (btn.dataset.action === 'edit') editAccount(index);
            if (btn.dataset.action === 'delete') deleteAccount(index);
            if (btn.dataset.action === 'toggle-lock') toggleAccountLock(index);
        });
    }

    // Event delegation cho bảng kho acc free
    const freeTbody = document.getElementById('adminFreeAccTableBody');
    if (freeTbody) {
        freeTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const index = Number(btn.dataset.index);
            if (btn.dataset.action === 'edit-free') editFreeAccount(index);
            if (btn.dataset.action === 'delete-free') deleteFreeAccount(index);
        });
    }
});

async function updateAdminNavLogo() {
    const logoEl = document.getElementById('adminNavLogo');
    if (!logoEl) return;
    const settings = getSettings();
    logoEl.src = await resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO);
}

async function verifyAdminPassword() {
    const pass = document.getElementById('adminPasswordInput').value;
    const msg = document.getElementById('loginMsg');
    msg.textContent = '';

    const ok = await verifyPassword(pass);
    if (ok) {
        sessionStorage.setItem('jh_admin_logged', 'true');
        document.getElementById('adminLoginBox').style.display = 'none';
        loadAdminData();
    } else {
        msg.textContent = 'Mật khẩu quản trị không chính xác!';
    }
}

function logoutAdmin() {
    sessionStorage.removeItem('jh_admin_logged');
    location.reload();
}

function loadAdminData() {
    renderAdminAccounts();
    renderFreeAccounts();
    loadSettingsToForm();
    renderActivityLog();
    updateAdminNavLogo();
}

// ============================================================
// QUẢN LÝ TÀI KHOẢN (CRUD + khóa nhanh acc nghi hack)
// ============================================================
async function renderAdminAccounts() {
    const accounts = getAccounts();
    const tbody = document.getElementById('adminAccTableBody');
    const fragment = document.createDocumentFragment();

    // Resolve song song tất cả ảnh (kể cả ảnh idb:) để không chặn tuần tự
    const thumbs = await Promise.all(
        accounts.map(acc => resolveMediaSrc(acc.img, 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300'))
    );

    accounts.forEach((acc, index) => {
        const statusInfo = STATUS_LABELS[acc.status] || STATUS_LABELS.selling;
        const typeInfo = ACCOUNT_TYPE_LABELS[acc.type] || ACCOUNT_TYPE_LABELS.reg;
        const isHacked = acc.status === 'hacked';
        const lockBtnClass = isHacked ? 'btn-unlock' : 'btn-lock';
        const lockBtnLabel = isHacked ? 'Mở Khóa' : 'Khóa (Nghi Hack)';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><img class="admin-thumb" src="${escapeHtml(thumbs[index])}" alt="Ảnh ${escapeHtml(acc.code)}" loading="lazy"></td>
            <td><b>${escapeHtml(acc.code)}</b></td>
            <td>${escapeHtml(acc.name)}</td>
            <td><span class="badge-status ${typeInfo.badge}">${typeInfo.text}</span></td>
            <td>${formatVND(acc.price)}</td>
            <td><span class="badge-status ${statusInfo.badge}">${statusInfo.text}</span></td>
            <td>
                <button class="btn-sm btn-edit" data-index="${index}" data-action="edit">Sửa</button>
                <button class="btn-sm ${lockBtnClass}" data-index="${index}" data-action="toggle-lock">${lockBtnLabel}</button>
                <button class="btn-sm btn-delete" data-index="${index}" data-action="delete">Xóa</button>
            </td>
        `;
        fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

// Khóa nhanh 1 acc bị nghi hack (hoặc mở khóa lại về "Đang bán") ngay từ bảng,
// không cần mở form sửa đầy đủ.
function toggleAccountLock(index) {
    const accounts = getAccounts();
    const acc = accounts[index];
    if (!acc) return;

    if (acc.status === 'hacked') {
        acc.status = 'selling';
        addActivityLog('Mở khóa tài khoản', `Acc ${acc.code} (${acc.name}) đã được mở khóa, chuyển về "Đang bán".`);
    } else {
        const reason = prompt(`Ghi chú lý do khóa acc ${acc.code} (không bắt buộc):`, 'Phát hiện đăng nhập lạ / dấu hiệu bị hack');
        acc.status = 'hacked';
        addActivityLog('Khóa tài khoản nghi hack', `Acc ${acc.code} (${acc.name}) đã bị khóa.${reason ? ' Lý do: ' + reason : ''}`);
    }

    saveAccounts(accounts);
    renderAdminAccounts();
    renderActivityLog();
}

async function saveAccount(event) {
    event.preventDefault();
    const editIndex = parseInt(document.getElementById('editIndex').value, 10);
    const accounts = getAccounts();
    const fileInput = document.getElementById('accImgFileInput');
    const urlValue = document.getElementById('accImgInput').value.trim();

    let imgField;
    if (fileInput.files && fileInput.files[0]) {
        imgField = await storeUploadedFile(fileInput.files[0], 'acc_img');
    } else if (urlValue) {
        imgField = urlValue;
    } else if (editIndex !== -1) {
        imgField = accounts[editIndex].img; // giữ ảnh cũ nếu không đổi gì
    } else {
        imgField = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300';
    }

    const newAcc = {
        id: editIndex === -1 ? Date.now() : accounts[editIndex].id,
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

    if (editIndex === -1) {
        accounts.unshift(newAcc);
        addActivityLog('Thêm tài khoản mới', `Đã thêm acc ${newAcc.code} (${newAcc.name}).`);
    } else {
        accounts[editIndex] = newAcc;
        document.getElementById('editIndex').value = -1;
        addActivityLog('Cập nhật tài khoản', `Đã cập nhật acc ${newAcc.code} (${newAcc.name}).`);
    }

    saveAccounts(accounts);
    document.getElementById('accForm').reset();
    clearAccImageUpload();
    renderAdminAccounts();
    renderActivityLog();
    alert('Lưu tài khoản thành công!');
}

function editAccount(index) {
    const acc = getAccounts()[index];
    if (!acc) return;

    document.getElementById('editIndex').value = index;
    document.getElementById('accCodeInput').value = acc.code;
    document.getElementById('accNameInput').value = acc.name;
    document.getElementById('accInfoInput').value = acc.info || '';
    document.getElementById('accDescInput').value = acc.description || '';
    document.getElementById('accPriceInput').value = acc.price;
    document.getElementById('accCategoryInput').value = acc.category;
    document.getElementById('accTypeInput').value = acc.type || 'reg';
    document.getElementById('accStatusInput').value = acc.status;
    // Nếu ảnh hiện tại là ảnh tải lên (idb:), không có URL để hiển thị lại trong ô link —
    // để trống ô URL và giữ nguyên ảnh cũ trừ khi admin chọn ảnh mới.
    document.getElementById('accImgInput').value = acc.img && acc.img.startsWith(IDB_PREFIX) ? '' : (acc.img || '');
    clearAccImageUpload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteAccount(index) {
    const accounts = getAccounts();
    const acc = accounts[index];
    if (!acc) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản ${acc.code} không?`)) return;

    if (acc.img && acc.img.startsWith(IDB_PREFIX)) {
        await deleteFileBlob(acc.img.slice(IDB_PREFIX.length));
    }

    accounts.splice(index, 1);
    saveAccounts(accounts);
    addActivityLog('Xóa tài khoản', `Đã xóa acc ${acc.code} (${acc.name}).`);
    renderAdminAccounts();
    renderActivityLog();
}

function clearAccImageUpload() {
    const fileInput = document.getElementById('accImgFileInput');
    if (fileInput) fileInput.value = '';
}

// ============================================================
// KHO ACC RANDOM FREE — quản lý danh sách acc dùng để tặng khi khách quay trúng
// ở trang "Acc Random Free" (xác suất 1/1000/ngày/thiết bị).
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
    accounts.forEach((acc, index) => {
        const tr = document.createElement('tr');
        const statusBadge = acc.claimed
            ? '<span class="badge-status badge-sold">Đã trao thưởng</span>'
            : '<span class="badge-status badge-selling">Còn trong kho</span>';
        tr.innerHTML = `
            <td><img class="admin-thumb" src="${escapeHtml(acc.img || DEFAULT_LOGO)}" alt="Ảnh ${escapeHtml(acc.code)}" loading="lazy"></td>
            <td><b>${escapeHtml(acc.code)}</b></td>
            <td>${escapeHtml(acc.name)}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn-sm btn-edit" data-index="${index}" data-action="edit-free">Sửa</button>
                <button class="btn-sm btn-delete" data-index="${index}" data-action="delete-free">Xóa</button>
            </td>
        `;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

function saveFreeAccount(event) {
    event.preventDefault();
    const editIndex = parseInt(document.getElementById('freeEditIndex').value, 10);
    const accounts = getFreeAccounts();

    const newAcc = {
        id: editIndex === -1 ? Date.now() : accounts[editIndex].id,
        code: document.getElementById('freeCodeInput').value.trim(),
        name: document.getElementById('freeNameInput').value.trim(),
        info: document.getElementById('freeInfoInput').value.trim(),
        description: document.getElementById('freeDescInput').value.trim(),
        img: document.getElementById('freeImgInput').value.trim(),
        claimed: editIndex === -1 ? false : accounts[editIndex].claimed,
        claimedAt: editIndex === -1 ? null : accounts[editIndex].claimedAt
    };

    if (editIndex === -1) {
        accounts.unshift(newAcc);
        addActivityLog('Thêm acc free', `Đã thêm acc tặng ${newAcc.code} (${newAcc.name}) vào kho Random Free.`);
    } else {
        accounts[editIndex] = newAcc;
        document.getElementById('freeEditIndex').value = -1;
        addActivityLog('Cập nhật acc free', `Đã cập nhật acc tặng ${newAcc.code} (${newAcc.name}).`);
    }

    saveFreeAccounts(accounts);
    document.getElementById('freeAccForm').reset();
    renderFreeAccounts();
    renderActivityLog();
    alert('Lưu acc free thành công!');
}

function editFreeAccount(index) {
    const acc = getFreeAccounts()[index];
    if (!acc) return;
    document.getElementById('freeEditIndex').value = index;
    document.getElementById('freeCodeInput').value = acc.code;
    document.getElementById('freeNameInput').value = acc.name;
    document.getElementById('freeInfoInput').value = acc.info || '';
    document.getElementById('freeDescInput').value = acc.description || '';
    document.getElementById('freeImgInput').value = acc.img || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteFreeAccount(index) {
    const accounts = getFreeAccounts();
    const acc = accounts[index];
    if (!acc) return;
    if (!confirm(`Xóa acc free ${acc.code} khỏi kho tặng?`)) return;

    accounts.splice(index, 1);
    saveFreeAccounts(accounts);
    addActivityLog('Xóa acc free', `Đã xóa acc tặng ${acc.code} (${acc.name}) khỏi kho Random Free.`);
    renderFreeAccounts();
    renderActivityLog();
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

function handleClearLog() {
    if (!confirm('Xóa toàn bộ nhật ký hoạt động?')) return;
    clearActivityLog();
    renderActivityLog();
}

// ============================================================
// CẤU HÌNH HỆ THỐNG: thông tin chung, logo, avatar, nhạc, social links
// ============================================================
async function loadSettingsToForm() {
    const settings = getSettings();
    const titleInput = document.getElementById('settingAdminTitle');
    if (!titleInput) return;

    titleInput.value = settings.adminTitle || '';
    document.getElementById('settingIntroText').value = settings.introText || '';
    document.getElementById('settingBankName').value = settings.bankName || '';
    document.getElementById('settingBankAcc').value = settings.bankAcc || '';
    // Nếu nhạc hiện tại là file tải lên (idb:), không có URL để hiện lại — để trống ô URL.
    document.getElementById('settingAudioUrl').value = settings.audioUrl && settings.audioUrl.startsWith(IDB_PREFIX) ? '' : (settings.audioUrl || '');

    document.getElementById('settingSocialTiktok').value = settings.socialLinks.tiktok || '';
    document.getElementById('settingSocialYoutube').value = settings.socialLinks.youtube || '';
    document.getElementById('settingSocialZalo').value = settings.socialLinks.zalo || '';
    document.getElementById('settingSocialFacebook').value = settings.socialLinks.facebook || '';

    document.getElementById('logoPreview').src = await resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO);
    document.getElementById('avatarPreview').src = await resolveMediaSrc(settings.avatarUrl, DEFAULT_LOGO);

    const qrPreview = document.getElementById('qrPreview');
    if (qrPreview) {
        qrPreview.src = settings.qrImageUrl ? await resolveMediaSrc(settings.qrImageUrl, '') : '';
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
    const settings = getSettings();

    settings.adminTitle = document.getElementById('settingAdminTitle').value;
    settings.introText = document.getElementById('settingIntroText').value;
    settings.bankName = document.getElementById('settingBankName').value;
    settings.bankAcc = document.getElementById('settingBankAcc').value;

    // Logo shop
    const logoFile = document.getElementById('settingLogoFile').files[0];
    if (logoFile) {
        await replaceMediaField(settings, 'logoUrl', logoFile, 'shop_logo');
    }

    // Avatar admin
    const avatarFile = document.getElementById('settingAvatarFile').files[0];
    if (avatarFile) {
        await replaceMediaField(settings, 'avatarUrl', avatarFile, 'admin_avatar');
    }

    // Ảnh QR thanh toán tải từ thiết bị (ưu tiên dùng thay QR tự sinh nếu có)
    const qrFile = document.getElementById('settingQrFile') ? document.getElementById('settingQrFile').files[0] : null;
    if (qrFile) {
        await replaceMediaField(settings, 'qrImageUrl', qrFile, 'payment_qr');
    }

    // Nhạc nền: ưu tiên file tải lên nếu có chọn, nếu không thì dùng URL đã nhập
    const audioFile = document.getElementById('settingAudioFile').files[0];
    if (audioFile) {
        await replaceMediaField(settings, 'audioUrl', audioFile, 'bg_audio');
    } else {
        const urlValue = document.getElementById('settingAudioUrl').value.trim();
        if (urlValue) {
            if (settings.audioUrl && settings.audioUrl.startsWith(IDB_PREFIX)) {
                await deleteFileBlob(settings.audioUrl.slice(IDB_PREFIX.length));
            }
            settings.audioUrl = urlValue;
        }
    }

    settings.socialLinks = {
        tiktok: document.getElementById('settingSocialTiktok').value.trim(),
        youtube: document.getElementById('settingSocialYoutube').value.trim(),
        zalo: document.getElementById('settingSocialZalo').value.trim(),
        facebook: document.getElementById('settingSocialFacebook').value.trim()
    };

    saveSettings(settings);
    addActivityLog('Cập nhật cấu hình hệ thống', 'Đã cập nhật thông tin chung / logo / avatar / nhạc nền / liên kết mạng xã hội.');
    renderActivityLog();
    await loadSettingsToForm();
    updateAdminNavLogo();
    alert('Đã cập nhật cấu hình hệ thống thành công!');
}

// Thay 1 field ảnh/nhạc bằng file mới, tự dọn file cũ (nếu là idb:) để tránh rác trong IndexedDB
async function replaceMediaField(settings, fieldName, file, keyPrefix) {
    const oldValue = settings[fieldName];
    settings[fieldName] = await storeUploadedFile(file, keyPrefix);
    if (oldValue && oldValue.startsWith(IDB_PREFIX)) {
        await deleteFileBlob(oldValue.slice(IDB_PREFIX.length));
    }
}

// Khôi phục 1 field ảnh/nhạc về giá trị mặc định, dọn file cũ nếu có
async function resetMediaField(fieldName) {
    const settings = getSettings();
    const oldValue = settings[fieldName];
    if (oldValue && oldValue.startsWith(IDB_PREFIX)) {
        await deleteFileBlob(oldValue.slice(IDB_PREFIX.length));
    }
    settings[fieldName] = DEFAULT_SETTINGS[fieldName];
    saveSettings(settings);
    addActivityLog('Khôi phục mặc định', `Đã khôi phục "${fieldName}" về giá trị mặc định.`);
    renderActivityLog();
    await loadSettingsToForm();
    updateAdminNavLogo();
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

    const isCurrentValid = await verifyPassword(current);
    if (!isCurrentValid) {
        msg.classList.add('error');
        msg.textContent = 'Mật khẩu hiện tại không đúng.';
        return;
    }
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

    await changeAdminPassword(next);
    addActivityLog('Đổi mật khẩu quản trị', 'Mật khẩu đăng nhập trang quản trị đã được thay đổi.');
    renderActivityLog();

    msg.classList.add('success');
    msg.textContent = 'Đổi mật khẩu thành công!';
    document.getElementById('changePasswordForm').reset();
}
