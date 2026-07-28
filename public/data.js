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
    ttx: { text: 'Acc TTX', badge: 'type-ttx' },
    doiso: { text: 'Acc Đổi Số', badge: 'type-doiso' }
};

const DEFAULT_LOGO = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100";

// Nhãn loại sự kiện (mục 6 — Quản lý Sự kiện). Giai đoạn 2: 4 loại sự kiện dùng chung 1 tầng
// hạ tầng (thời gian, kho quà, khóa QR, giới hạn lượt chơi) nhưng khác nhau ở giao diện chơi.
const EVENT_TYPE_LABELS = {
    uu_dai: 'Giảm Deal',
    vong_quay: 'Vòng Quay May Mắn',
    dap_tho: 'Đập Thỏ May Mắn',
    dap_hop: 'Đập Hộp May Mắn',
    tham_gia: 'Tham gia',
    khac: 'Khác'
};

// Nhãn trạng thái yêu cầu tham gia sự kiện (khóa QR)
const EVENT_REQUEST_STATUS_LABELS = {
    pending: { text: 'Chờ duyệt', badge: 'badge-sold' },
    approved: { text: 'Đã duyệt', badge: 'badge-selling' },
    rejected: { text: 'Đã từ chối', badge: 'badge-hacked' }
};

// Nhãn trạng thái yêu cầu mua acc
const PURCHASE_REQUEST_STATUS_LABELS = {
    pending: { text: 'Chờ duyệt', badge: 'badge-sold' },
    approved: { text: 'Đã duyệt', badge: 'badge-selling' },
    rejected: { text: 'Đã từ chối', badge: 'badge-hacked' }
};

// Nhãn trạng thái tài khoản khách hàng
const CUSTOMER_STATUS_LABELS = {
    active: { text: 'Hoạt động', badge: 'badge-selling' },
    locked: { text: 'Đã khóa', badge: 'badge-hacked' }
};

// Nhãn trạng thái yêu cầu khôi phục mật khẩu
const RECOVERY_REQUEST_STATUS_LABELS = {
    pending: { text: 'Chờ xử lý', badge: 'badge-sold' },
    resolved: { text: 'Đã xử lý', badge: 'badge-selling' }
};

// ------------------------------------------------------------
// Bộ nhớ đệm trong phiên trang — nạp 1 lần lúc tải trang (initClientData / initAdminData),
// các hàm ghi (create/update/delete...) tự cập nhật lại cache sau khi máy chủ xác nhận.
// ------------------------------------------------------------
let _accountsCache = [];
let _freeAccountsCache = [];
let _settingsCache = {};
let _eventsCache = [];
let _eventRequestsCache = [];
let _activityLogCache = [];
let _purchaseRequestsCache = [];
let _customersCache = [];
let _passwordRecoveryRequestsCache = [];

function getAccounts() { return _accountsCache; }
function getFreeAccounts() { return _freeAccountsCache; }
function getSettings() { return _settingsCache; }
function getEvents() { return _eventsCache; }
function getEventRequests() { return _eventRequestsCache; }
function getActivityLog() { return _activityLogCache; }
function getPurchaseRequestsAdmin() { return _purchaseRequestsCache; }
function getCustomers() { return _customersCache; }
function getPasswordRecoveryRequests() { return _passwordRecoveryRequestsCache; }

// ------------------------------------------------------------
// Gọi API dùng chung — tự đính token quản trị (nếu có) và tự báo khi phiên hết hạn.
// ------------------------------------------------------------
function getAdminToken() { return sessionStorage.getItem('jh_admin_token'); }
function setAdminToken(token) {
    if (token) sessionStorage.setItem('jh_admin_token', token);
    else sessionStorage.removeItem('jh_admin_token');
}
function isAdminLoggedIn() { return !!getAdminToken(); }

// Tài khoản khách hàng (đăng ký/đăng nhập bắt buộc trước khi mua acc / tham gia sự kiện có
// phí) — lưu ở localStorage (không phải sessionStorage) để khách không phải đăng nhập lại
// mỗi khi mở tab mới, khác với phiên Admin chỉ tồn tại trong 1 tab.
function getCustomerToken() { return localStorage.getItem('jh_customer_token'); }
function setCustomerToken(token) {
    if (token) localStorage.setItem('jh_customer_token', token);
    else localStorage.removeItem('jh_customer_token');
}
function getCustomerUsername() { return localStorage.getItem('jh_customer_username') || ''; }
function setCustomerUsername(name) {
    if (name) localStorage.setItem('jh_customer_username', name);
    else localStorage.removeItem('jh_customer_username');
}
function isCustomerLoggedIn() { return !!getCustomerToken(); }

async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    // Ưu tiên token Admin (trang quản trị); nếu không có thì dùng token khách hàng (trang Shop) —
    // 2 trang không bao giờ cùng có cả 2 loại token nên không xung đột nhau.
    const adminToken = getAdminToken();
    const customerToken = getCustomerToken();
    const token = adminToken || customerToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (res.status === 401 && path !== '/api/admin/login' && path !== '/api/customer/login' && path !== '/api/customer/register') {
        if (adminToken) {
            setAdminToken(null);
            const loginBox = document.getElementById('adminLoginBox');
            if (loginBox) {
                loginBox.style.display = 'flex';
                const msg = document.getElementById('loginMsg');
                if (msg) msg.textContent = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';
            }
        } else if (customerToken) {
            // Phiên khách hết hạn hoặc tài khoản vừa bị khóa — dọn token cũ, để script.js (nếu có
            // định nghĩa onCustomerSessionExpired) tự cập nhật lại giao diện đăng nhập.
            setCustomerToken(null);
            setCustomerUsername(null);
            if (typeof onCustomerSessionExpired === 'function') onCustomerSessionExpired();
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
    _eventRequestsCache = state.eventRequests || [];
    _purchaseRequestsCache = state.purchaseRequests || [];
    _customersCache = state.customers || [];
    _passwordRecoveryRequestsCache = state.passwordRecoveryRequests || [];
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
    const settings = getSettings();
    if (settings && settings.discount5Locked) return false;
    return !!acc && acc.type !== 'reg' && !discountUsed;
}

// Sự kiện "Giảm Deal" (uu_dai) đang hoạt động có % giảm cao nhất. Bản thân hàm này không lọc
// theo loại acc — việc loại trừ Acc Reg được xử lý tập trung ở getAccountDiscountInfo() (script.js)
// để chắc chắn Acc Reg không bao giờ được giảm giá dù nguồn giảm giá là gì. Nếu có nhiều sự kiện
// Giảm Deal cùng hoạt động, lấy sự kiện có % giảm cao nhất để khách luôn được hưởng ưu đãi tốt nhất.
function getBestActiveDealEvent() {
    const deals = getEvents().filter(ev => ev.type === 'uu_dai' && ev.displayState === 'active' && Number(ev.discountPercent) > 0);
    if (deals.length === 0) return null;
    return deals.reduce((best, ev) => (Number(ev.discountPercent) > Number(best.discountPercent) ? ev : best), deals[0]);
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

// Giai đoạn 2 — khóa QR: khách gửi yêu cầu tham gia (đã chuyển khoản theo QR + số tiền admin
// đặt), yêu cầu rơi vào "pending" và chờ Admin duyệt trong trang quản trị. Bắt buộc đã đăng
// nhập tài khoản khách hàng — payerName/payerBankAccount dùng khi khách quên ghi nội dung CK.
async function requestEventAccessApi(eventId, note, payerName, payerBankAccount) {
    return apiFetch(`/api/events/${eventId}/request-access`, {
        method: 'POST',
        body: JSON.stringify({ deviceCode: getOrCreateDeviceCode(), note, payerName, payerBankAccount })
    });
}

// --- Quản trị: danh sách + duyệt/từ chối yêu cầu tham gia sự kiện ---
async function fetchEventRequestsApi() {
    const list = await apiFetch('/api/admin/event-requests');
    _eventRequestsCache = list;
    return list;
}
async function approveEventRequestApi(id) {
    const reqEntry = await apiFetch(`/api/admin/event-requests/${id}/approve`, { method: 'PUT' });
    const idx = _eventRequestsCache.findIndex(r => r.id === id);
    if (idx !== -1) _eventRequestsCache[idx] = reqEntry;
    return reqEntry;
}
async function rejectEventRequestApi(id) {
    const reqEntry = await apiFetch(`/api/admin/event-requests/${id}/reject`, { method: 'PUT' });
    const idx = _eventRequestsCache.findIndex(r => r.id === id);
    if (idx !== -1) _eventRequestsCache[idx] = reqEntry;
    return reqEntry;
}

// --- Quản trị: danh sách + duyệt/từ chối yêu cầu mua acc ---
async function fetchPurchaseRequestsAdminApi() {
    const list = await apiFetch('/api/admin/purchase-requests');
    _purchaseRequestsCache = list;
    return list;
}
async function approvePurchaseRequestApi(id, deliveredAccount, deliveredPassword) {
    const reqEntry = await apiFetch(`/api/admin/purchase-requests/${id}/approve`, { method: 'PUT', body: JSON.stringify({ deliveredAccount, deliveredPassword }) });
    const idx = _purchaseRequestsCache.findIndex(r => r.id === id);
    if (idx !== -1) _purchaseRequestsCache[idx] = reqEntry;
    return reqEntry;
}
async function rejectPurchaseRequestApi(id, reason) {
    const reqEntry = await apiFetch(`/api/admin/purchase-requests/${id}/reject`, { method: 'PUT', body: JSON.stringify({ reason }) });
    const idx = _purchaseRequestsCache.findIndex(r => r.id === id);
    if (idx !== -1) _purchaseRequestsCache[idx] = reqEntry;
    return reqEntry;
}

// ------------------------------------------------------------
// QUẢN TRỊ: QUẢN LÝ KHÁCH HÀNG (khóa/mở khóa/xóa/xem-đặt lại mật khẩu) + yêu cầu khôi phục
// ------------------------------------------------------------
async function fetchCustomersAdminApi() {
    const list = await apiFetch('/api/admin/customers');
    _customersCache = list;
    return list;
}
async function toggleCustomerLockApi(id, reason) {
    const customer = await apiFetch(`/api/admin/customers/${id}/toggle-lock`, { method: 'PUT', body: JSON.stringify({ reason }) });
    const idx = _customersCache.findIndex(c => c.id === id);
    if (idx !== -1) _customersCache[idx] = customer;
    return customer;
}
async function deleteCustomerApi(id, adminPassword) {
    await apiFetch(`/api/admin/customers/${id}`, { method: 'DELETE', body: JSON.stringify({ adminPassword }) });
    _customersCache = _customersCache.filter(c => c.id !== id);
}
async function viewCustomerPasswordApi(id, adminPassword) {
    return apiFetch(`/api/admin/customers/${id}/view-password`, { method: 'POST', body: JSON.stringify({ adminPassword }) });
}
async function resetCustomerPasswordApi(id, adminPassword) {
    const result = await apiFetch(`/api/admin/customers/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ adminPassword }) });
    // Đặt lại mật khẩu cũng tự mở khóa tài khoản ở server -> cập nhật lại cache trạng thái
    const idx = _customersCache.findIndex(c => c.id === id);
    if (idx !== -1) { _customersCache[idx].status = 'active'; _customersCache[idx].failedAttempts = 0; }
    return result;
}
async function fetchPasswordRecoveryRequestsApi() {
    const list = await apiFetch('/api/admin/password-recovery-requests');
    _passwordRecoveryRequestsCache = list;
    return list;
}
async function resolveRecoveryRequestApi(id) {
    const reqEntry = await apiFetch(`/api/admin/password-recovery-requests/${id}/resolve`, { method: 'PUT' });
    const idx = _passwordRecoveryRequestsCache.findIndex(r => r.id === id);
    if (idx !== -1) _passwordRecoveryRequestsCache[idx] = reqEntry;
    return reqEntry;
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

// ------------------------------------------------------------
// TÀI KHOẢN KHÁCH HÀNG — bắt buộc đăng ký (nếu chưa có) / đăng nhập (nếu đã có) trước khi mua
// acc hoặc tham gia sự kiện có phí. Token lưu localStorage nên khách không phải đăng nhập lại
// mỗi lần mở lại trang.
// ------------------------------------------------------------
async function customerRegisterApi(username, password) {
    const data = await apiFetch('/api/customer/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    setCustomerToken(data.token);
    setCustomerUsername(data.username);
    return data;
}
async function customerLoginApi(username, password) {
    const data = await apiFetch('/api/customer/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setCustomerToken(data.token);
    setCustomerUsername(data.username);
    return data;
}
async function customerLogoutApi() {
    try { await apiFetch('/api/customer/logout', { method: 'POST' }); } catch (e) { /* phiên có thể đã hết hạn, bỏ qua */ }
    setCustomerToken(null);
    setCustomerUsername(null);
}
async function customerRecoveryRequestApi(username, note) {
    return apiFetch('/api/customer/recovery-request', { method: 'POST', body: JSON.stringify({ username, note }) });
}

// ------------------------------------------------------------
// YÊU CẦU MUA ACC — gửi kèm tên/số tài khoản đã chuyển (phòng khi quên ghi nội dung CK) để
// Admin đối chiếu ngân hàng đã nhận tiền rồi duyệt. deadlineMs trả về dùng để đếm ngược 5 phút
// trước khi hiện nút chat Zalo hỗ trợ nếu Admin chưa kịp duyệt.
// ------------------------------------------------------------
async function submitPurchaseRequestApi(accountId, payerName, payerBankAccount, phoneNumber) {
    return apiFetch('/api/purchase-requests', {
        method: 'POST',
        body: JSON.stringify({ accountId, payerName, payerBankAccount, phoneNumber })
    });
}
async function getMyPurchaseRequestsApi() {
    return apiFetch('/api/purchase-requests/mine');
}
async function getMyPurchaseHistoryApi() {
    return apiFetch('/api/customer/purchase-history');
}
