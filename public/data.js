// ============================================================
// data.js — Lớp giao tiếp API dùng chung cho toàn hệ thống (trang khách + trang quản trị)
// Toàn bộ dữ liệu (acc, acc free, cấu hình, sự kiện, nhật ký) giờ lưu VĨNH VIỄN
// trên máy chủ (xem thư mục server/), không còn phụ thuộc localStorage/IndexedDB
// của từng trình duyệt như trước.
// ============================================================

// Nếu frontend & backend deploy KHÁC domain, đổi giá trị này thành URL đầy đủ của
// backend, VD: 'https://jhush-api.onrender.com'. Nếu CÙNG domain (khuyến nghị), để rỗng.
const API_BASE_URL = '';

// Nhãn hiển thị cho 3 loại acc: Reg (mới đăng ký) / VIP / TTX
const ACCOUNT_TYPE_LABELS = {
    reg: { text: 'Acc Reg', badge: 'type-reg' },
    vip: { text: 'Acc VIP', badge: 'type-vip' },
    ttx: { text: 'Acc TTX', badge: 'type-ttx' }
};

const DEFAULT_LOGO = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100";

// Nhãn loại sự kiện (mục 6 — Quản lý Sự kiện)
const EVENT_TYPE_LABELS = {
    uu_dai: 'Ưu đãi',
    tham_gia: 'Tham gia',
    khac: 'Khác'
};

// ------------------------------------------------------------
// Bộ nhớ đệm trong phiên trang — nạp 1 lần lúc tải trang (initClientData / initAdminData),
// các hàm ghi (create/update/delete...) tự cập nhật lại cache sau khi máy chủ xác nhận.
// ------------------------------------------------------------
let _accountsCache = [];
let _freeAccountsCache = [];
let _settingsCache = {};
let _eventsCache = [];
let _activityLogCache = [];

function getAccounts() { return _accountsCache; }
function getFreeAccounts() { return _freeAccountsCache; }
function getSettings() { return _settingsCache; }
function getEvents() { return _eventsCache; }
function getActivityLog() { return _activityLogCache; }

// ------------------------------------------------------------
// Gọi API dùng chung — tự đính token quản trị (nếu có) và tự báo khi phiên hết hạn.
// ------------------------------------------------------------
function getAdminToken() { return sessionStorage.getItem('jh_admin_token'); }
function setAdminToken(token) {
    if (token) sessionStorage.setItem('jh_admin_token', token);
    else sessionStorage.removeItem('jh_admin_token');
}
function isAdminLoggedIn() { return !!getAdminToken(); }

async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getAdminToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (res.status === 401 && path !== '/api/admin/login') {
        setAdminToken(null);
        const loginBox = document.getElementById('adminLoginBox');
        if (loginBox) {
            loginBox.style.display = 'flex';
            const msg = document.getElementById('loginMsg');
            if (msg) msg.textContent = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';
        }
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* phản hồi rỗng, bỏ qua */ }
    if (!res.ok) throw new Error((data && data.error) || `Lỗi máy chủ (${res.status})`);
    return data;
}

// Nạp dữ liệu công khai cho trang khách (accounts, freeAccounts, settings, sự kiện đang hoạt động)
async function initClientData() {
    const state = await apiFetch('/api/state');
    _accountsCache = state.accounts;
    _freeAccountsCache = state.freeAccounts;
    _settingsCache = state.settings;
    _eventsCache = state.events;
    return state;
}

// Nạp toàn bộ dữ liệu quản trị (yêu cầu đã đăng nhập — bao gồm cả nhật ký & sự kiện đang ẩn)
async function initAdminData() {
    const state = await apiFetch('/api/admin/state');
    _accountsCache = state.accounts;
    _freeAccountsCache = state.freeAccounts;
    _settingsCache = state.settings;
    _eventsCache = state.events;
    _activityLogCache = state.activityLog;
    return state;
}

// ------------------------------------------------------------
// TÀI KHOẢN (kho acc bán)
// ------------------------------------------------------------
async function createAccount(payload) {
    const acc = await apiFetch('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
    _accountsCache.unshift(acc);
    return acc;
}
async function updateAccount(id, payload) {
    const acc = await apiFetch(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    const idx = _accountsCache.findIndex(a => a.id === id);
    if (idx !== -1) _accountsCache[idx] = acc;
    return acc;
}
async function toggleAccountLockApi(id, reason) {
    const acc = await apiFetch(`/api/accounts/${id}/lock`, { method: 'PUT', body: JSON.stringify({ reason }) });
    const idx = _accountsCache.findIndex(a => a.id === id);
    if (idx !== -1) _accountsCache[idx] = acc;
    return acc;
}
async function deleteAccountApi(id) {
    await apiFetch(`/api/accounts/${id}`, { method: 'DELETE' });
    _accountsCache = _accountsCache.filter(a => a.id !== id);
}

// ------------------------------------------------------------
// ACC FREE (kho tặng ở trang "Quay Là Trúng")
// ------------------------------------------------------------
async function createFreeAccount(payload) {
    const acc = await apiFetch('/api/free-accounts', { method: 'POST', body: JSON.stringify(payload) });
    _freeAccountsCache.unshift(acc);
    return acc;
}
async function updateFreeAccount(id, payload) {
    const acc = await apiFetch(`/api/free-accounts/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    const idx = _freeAccountsCache.findIndex(a => a.id === id);
    if (idx !== -1) _freeAccountsCache[idx] = acc;
    return acc;
}
async function deleteFreeAccountApi(id) {
    await apiFetch(`/api/free-accounts/${id}`, { method: 'DELETE' });
    _freeAccountsCache = _freeAccountsCache.filter(a => a.id !== id);
}

// ------------------------------------------------------------
// CẤU HÌNH HỆ THỐNG
// ------------------------------------------------------------
async function updateSettingsApi(payload) {
    const settings = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    _settingsCache = settings;
    return settings;
}

// ------------------------------------------------------------
// NHẬT KÝ HOẠT ĐỘNG
// ------------------------------------------------------------
async function clearActivityLogApi() {
    await apiFetch('/api/activity-log', { method: 'DELETE' });
    _activityLogCache = [];
}

// ------------------------------------------------------------
// TẢI TỆP (ảnh acc, logo, avatar, QR, nhạc nền, banner/ảnh phần thưởng sự kiện...)
// Trả về đường dẫn tương đối do máy chủ cấp, VD: "/uploads/172..._ab12cd.jpg"
// ------------------------------------------------------------
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const token = getAdminToken();
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

// Ảnh/nhạc giờ luôn là URL dùng trực tiếp được (URL ngoài hoặc "/uploads/..." do server cấp)
function resolveMediaSrc(field, fallback) {
    return field || fallback;
}

// ------------------------------------------------------------
// ĐĂNG NHẬP / PHIÊN QUẢN TRỊ — xác thực thật trên máy chủ (không còn kiểm tra ở trình duyệt)
// ------------------------------------------------------------
async function adminLogin(password) {
    const data = await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    setAdminToken(data.token);
    return true;
}
async function adminLogout() {
    try { await apiFetch('/api/admin/logout', { method: 'POST' }); } catch (e) { /* phiên có thể đã hết hạn, bỏ qua */ }
    setAdminToken(null);
}
async function changeAdminPasswordApi(currentPassword, newPassword) {
    await apiFetch('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

// ------------------------------------------------------------
// THIẾT BỊ (mã định danh ẩn danh phía trình duyệt) + VÒNG QUAY / MÃ GIẢM GIÁ — xác thực & chống
// gian lận thực hiện trên máy chủ (trình duyệt không còn tự quyết định thắng/thua nữa).
// ------------------------------------------------------------
function getOrCreateDeviceCode() {
    let code = localStorage.getItem('jh_device_code');
    if (!code) {
        code = 'JH-DISC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem('jh_device_code', code);
    }
    return code;
}

async function getDeviceStatus() {
    return apiFetch(`/api/device/${encodeURIComponent(getOrCreateDeviceCode())}/status`);
}
async function spinPromoWheelApi() {
    return apiFetch('/api/spin/promo', { method: 'POST', body: JSON.stringify({ deviceCode: getOrCreateDeviceCode() }) });
}
async function spinFreeAccountApi() {
    const result = await apiFetch('/api/spin/free', { method: 'POST', body: JSON.stringify({ deviceCode: getOrCreateDeviceCode() }) });
    if (result.prize) {
        const idx = _freeAccountsCache.findIndex(a => a.code === result.prize.code);
        if (idx !== -1) _freeAccountsCache[idx] = result.prize; else _freeAccountsCache.push(result.prize);
    }
    return result;
}
async function markDiscountUsedApi() {
    return apiFetch('/api/discount/use', { method: 'POST', body: JSON.stringify({ deviceCode: getOrCreateDeviceCode() }) });
}
function isEligibleForDiscount(acc, discountUsed) {
    return !!acc && acc.type !== 'reg' && !discountUsed;
}

// ------------------------------------------------------------
// SỰ KIỆN (mục 6) — mỗi sự kiện là 1 vòng quay độc lập, có kho phần thưởng & tỉ lệ riêng
// ------------------------------------------------------------
async function createEventApi(payload) {
    const ev = await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(payload) });
    _eventsCache.unshift(ev);
    return ev;
}
async function updateEventApi(id, payload) {
    const ev = await apiFetch(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    const idx = _eventsCache.findIndex(e => e.id === id);
    if (idx !== -1) _eventsCache[idx] = ev;
    return ev;
}
async function toggleEventStatusApi(id) {
    const ev = await apiFetch(`/api/events/${id}/toggle`, { method: 'PUT' });
    const idx = _eventsCache.findIndex(e => e.id === id);
    if (idx !== -1) _eventsCache[idx] = ev;
    return ev;
}
async function deleteEventApi(id) {
    await apiFetch(`/api/events/${id}`, { method: 'DELETE' });
    _eventsCache = _eventsCache.filter(e => e.id !== id);
}
async function spinEventWheelApi(eventId) {
    return apiFetch(`/api/events/${eventId}/spin`, { method: 'POST', body: JSON.stringify({ deviceCode: getOrCreateDeviceCode() }) });
}

// ------------------------------------------------------------
// TIỆN ÍCH CHUNG
// ------------------------------------------------------------
function formatVND(amount) {
    return Number(amount).toLocaleString('vi-VN') + 'đ';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
}

function formatDateTime(ts) {
    return new Date(ts).toLocaleString('vi-VN');
}
