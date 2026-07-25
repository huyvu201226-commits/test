// ============================================================
// data.js — Lớp truy xuất dữ liệu dùng chung cho toàn hệ thống
// Dùng chung bởi script.js (trang khách) và admin.js (trang quản trị)
// ============================================================

const STORAGE_KEYS = {
    accounts: 'jh_accounts',
    freeAccounts: 'jh_free_accounts',
    settings: 'jh_settings',
    deviceCode: 'jh_device_code',
    activityLog: 'jh_activity_log',
    promoWheelState: 'jh_promo_wheel_state',   // vòng quay ưu đãi (tab Ưu Đãi) — reset theo THÁNG
    freeSpinState: 'jh_freespin_state',        // vòng quay acc random free — reset theo NGÀY
    discountState: 'jh_discount_state'         // trạng thái đã dùng mã giảm 5% hay chưa (theo thiết bị)
};

// Nhãn hiển thị cho 3 loại acc: Reg (mới đăng ký) / VIP / TTX
const ACCOUNT_TYPE_LABELS = {
    reg: { text: 'Acc Reg', badge: 'type-reg' },
    vip: { text: 'Acc VIP', badge: 'type-vip' },
    ttx: { text: 'Acc TTX', badge: 'type-ttx' }
};

// Tiền tố đánh dấu một trường ảnh/nhạc đang trỏ tới file lưu trong IndexedDB
// thay vì một URL bình thường, ví dụ: "idb:acc_img_173..." 
const IDB_PREFIX = 'idb:';

// Mỗi acc giờ tách riêng "name" (tiêu đề ngắn), "info" (thông tin nhanh: rank, số tướng/skin...)
// và "description" (mô tả chi tiết dài hơn) — không gộp chung vào 1 chuỗi như trước.
// "type" là loại acc: reg (mới đăng ký) / vip / ttx — độc lập với "category" (dùng để lọc theo mức giá).
const DEFAULT_ACCOUNTS = [
    { id: 1, code: "JH-01", name: "Acc Liên Quân Siêu VIP 50 Tướng", info: "50 tướng, 80 skin, Rank Cao Thủ", description: "Acc chính chủ nuôi lâu năm, đầy đủ ngọc, chưa từng bị khóa hay báo cáo vi phạm.", price: 350000, category: "mid", type: "vip", status: "selling", img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300" },
    { id: 2, code: "JH-02", name: "Acc FreeFire Full Skin Súng 99k", info: "Full skin súng, Rank Kim Cương", description: "Acc giá rẻ phù hợp người mới, mật khẩu độc lập chưa liên kết mạng xã hội.", price: 99000, category: "cheap", type: "reg", status: "selling", img: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300" },
    { id: 3, code: "JH-03", name: "Acc VIP Đột Kích Cực Khủng", info: "Full VIP, kho súng khủng", description: "Acc VIP vĩnh viễn, đã đổi thông tin bảo mật, bàn giao ngay sau thanh toán.", price: 1200000, category: "high", type: "vip", status: "selling", img: "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=300" },
    { id: 4, code: "JH-04", name: "Acc Tốc Chiến Rank Thách Đấu", info: "Rank Thách Đấu, Full tướng/trang phục", description: "Acc top server, thông tin đã ẩn danh, hỗ trợ đổi mail sau khi mua.", price: 2500000, category: "expensive", type: "ttx", status: "sold", img: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=300" }
];

// Kho acc dùng để tặng miễn phí khi khách quay trúng ở trang "Acc Random Free".
// claimed=true nghĩa là acc đã được trao cho 1 lượt quay trúng và không dùng lại nữa.
const DEFAULT_FREE_ACCOUNTS = [
    { id: 1001, code: "FREE-01", name: "Acc Reg FreeFire Cơ Bản", info: "Rank Bạch Kim, vài skin cơ bản", description: "Acc reg tự nhiên, chưa gắn thông tin cá nhân nào, phù hợp làm acc phụ.", img: "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300", claimed: false, claimedAt: null },
    { id: 1002, code: "FREE-02", name: "Acc Reg Liên Quân Cơ Bản", info: "10 tướng, Rank Vàng", description: "Acc reg mới tạo, đủ điều kiện chơi xếp hạng ngay.", img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300", claimed: false, claimedAt: null }
];

const DEFAULT_LOGO = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100";

const DEFAULT_SETTINGS = {
    adminTitle: "J-HUSH / HUY ĐỨC",
    introText: "Chào cả nhà. Shop mk là buôn của các ad lớn (ad Công, Trâm ...vv) cọc ut và có ctv hơn 50 group.<br>- Mk buôn lên tương tác rộng ae nào cần tìm gì cứ ib mk 📩<br>- Có cân tg có check ut<br>- Hỗ trợ góp, tìm và lên đời acc (thuê acc trọn đời) 🔥<br>- Ae vào thì nhớ để mk một slot +kèo cân hết luôn 🥰<br>- Các dịch vụ khác liqi và ff<br><br><b>Lưu ý: Hãy là người gd thông minh 🫰</b><br>Theo dõi đồng hành cùng mk trên nền tảng khác nhớ...",
    bankName: "MB Bank",
    bankAcc: "0362062410",
    bankOwner: "VU HUY DUC",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    // Ảnh logo shop (navbar + màn chào) và ảnh đại diện admin (tab Giới thiệu).
    // Giá trị mặc định là URL; nếu admin tải ảnh từ máy lên, giá trị sẽ đổi thành "idb:...".
    logoUrl: DEFAULT_LOGO,
    avatarUrl: DEFAULT_LOGO,
    // Ảnh QR thanh toán do admin tự tải lên từ thiết bị (ưu tiên dùng thay cho QR tự sinh qua VietQR
    // nếu có). Rỗng = dùng QR tự động sinh theo bankName/bankAcc như trước.
    qrImageUrl: "",
    socialLinks: {
        tiktok: "https://www.tiktok.com/@j.hush06?_t=ZS-8wYxFErGfCi&_r=1",
        youtube: "https://www.youtube.com/channel/UCOy-qazssTHU3xxvhS6vx5Q",
        zalo: "https://zalo.me/0362062410",
        facebook: "" // để trống = hiển thị "Tạm khóa" như hiện tại
    },
    // Mật khẩu quản trị được băm (SHA-256 + salt), KHÔNG lưu plaintext trong code nữa.
    adminPasswordHash: null,
    adminPasswordSalt: null
};

// ------------------------------------------------------------
// Cache trong bộ nhớ: tránh gọi JSON.parse(localStorage.getItem(...))
// lặp lại nhiều lần trong cùng một phiên trang.
// ------------------------------------------------------------
let _accountsCache = null;
let _settingsCache = null;
let _freeAccountsCache = null;

function getAccounts() {
    if (_accountsCache) return _accountsCache;
    const raw = localStorage.getItem(STORAGE_KEYS.accounts);
    _accountsCache = raw ? JSON.parse(raw) : DEFAULT_ACCOUNTS.slice();
    if (!raw) localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(_accountsCache));
    return _accountsCache;
}

function saveAccounts(accounts) {
    _accountsCache = accounts;
    localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
}

// Kho acc tặng miễn phí (trang "Acc Random Free")
function getFreeAccounts() {
    if (_freeAccountsCache) return _freeAccountsCache;
    const raw = localStorage.getItem(STORAGE_KEYS.freeAccounts);
    _freeAccountsCache = raw ? JSON.parse(raw) : DEFAULT_FREE_ACCOUNTS.slice();
    if (!raw) localStorage.setItem(STORAGE_KEYS.freeAccounts, JSON.stringify(_freeAccountsCache));
    return _freeAccountsCache;
}

function saveFreeAccounts(accounts) {
    _freeAccountsCache = accounts;
    localStorage.setItem(STORAGE_KEYS.freeAccounts, JSON.stringify(accounts));
}

function getSettings() {
    if (_settingsCache) return _settingsCache;
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    // Merge với DEFAULT_SETTINGS để các bản cũ (chưa có socialLinks, logoUrl...) tự nâng cấp êm.
    _settingsCache = raw
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw), socialLinks: { ...DEFAULT_SETTINGS.socialLinks, ...(JSON.parse(raw).socialLinks || {}) } }
        : { ...DEFAULT_SETTINGS };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(_settingsCache));
    return _settingsCache;
}

function saveSettings(settings) {
    _settingsCache = settings;
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function getOrCreateDeviceCode() {
    let code = localStorage.getItem(STORAGE_KEYS.deviceCode);
    if (!code) {
        code = 'JH-DISC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem(STORAGE_KEYS.deviceCode, code);
    }
    return code;
}

// ============================================================
// VÒNG QUAY ƯU ĐÃI (tab "Ưu Đãi") — xác suất trúng thật 1/1000, reset mỗi THÁNG.
// VÒNG QUAY ACC RANDOM FREE — xác suất trúng thật 1/1000, reset mỗi NGÀY.
// MÃ GIẢM GIÁ 5% — mỗi thiết bị chỉ được áp dụng đúng 1 lần, không áp cho acc loại "reg".
//
// Lưu ý quan trọng: đây là kiểm tra phía trình duyệt (dựa vào localStorage của thiết bị/trình
// duyệt đang dùng), KHÔNG phải khóa theo địa chỉ IP thật. Người dùng xóa dữ liệu trình duyệt,
// dùng chế độ ẩn danh, hoặc đổi trình duyệt/thiết bị khác vẫn có thể quay lại hoặc dùng lại mã.
// Muốn khóa thật sự theo IP/tài khoản cần có máy chủ (backend) ghi nhận — xem ghi chú cuối chat.
// ============================================================
const WIN_PROBABILITY = 1 / 1000;

function getMonthKey(d = new Date()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function getDayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

// --- Vòng quay ưu đãi: 1 lượt / thiết bị / tháng, xác suất trúng 1/1000 ---
function getPromoWheelState() {
    const raw = localStorage.getItem(STORAGE_KEYS.promoWheelState);
    let state = raw ? JSON.parse(raw) : { month: '', spun: false, won: false };
    const currentMonth = getMonthKey();
    if (state.month !== currentMonth) {
        state = { month: currentMonth, spun: false, won: false };
        localStorage.setItem(STORAGE_KEYS.promoWheelState, JSON.stringify(state));
    }
    return state;
}

// Trả về { alreadySpun, won }. Chỉ tính là "đã quay" (tiêu tốn lượt) khi thực sự spin lần đầu trong tháng.
function spinPromoWheel() {
    const state = getPromoWheelState();
    if (state.spun) return { alreadySpun: true, won: state.won };
    const won = Math.random() < WIN_PROBABILITY;
    state.spun = true;
    state.won = won;
    localStorage.setItem(STORAGE_KEYS.promoWheelState, JSON.stringify(state));
    return { alreadySpun: false, won };
}

// --- Vòng quay Acc Random Free: 1 lượt / thiết bị / ngày, xác suất trúng 1/1000 ---
function getFreeSpinState() {
    const raw = localStorage.getItem(STORAGE_KEYS.freeSpinState);
    let state = raw ? JSON.parse(raw) : { day: '', spun: false, won: false, prizeCode: null };
    const currentDay = getDayKey();
    if (state.day !== currentDay) {
        state = { day: currentDay, spun: false, won: false, prizeCode: null };
        localStorage.setItem(STORAGE_KEYS.freeSpinState, JSON.stringify(state));
    }
    return state;
}

// Trả về { alreadySpun, won, prize }. Nếu trúng thưởng sẽ rút ngẫu nhiên 1 acc còn trống trong kho
// acc free và đánh dấu đã trao (claimed) để không bị trao trùng cho lượt quay khác.
function spinFreeAccount() {
    const state = getFreeSpinState();
    if (state.spun) {
        const prize = state.prizeCode ? getFreeAccounts().find(a => a.code === state.prizeCode) : null;
        return { alreadySpun: true, won: state.won, prize };
    }

    let won = Math.random() < WIN_PROBABILITY;
    let prize = null;

    if (won) {
        const pool = getFreeAccounts().filter(a => !a.claimed);
        if (pool.length > 0) {
            prize = pool[Math.floor(Math.random() * pool.length)];
            prize.claimed = true;
            prize.claimedAt = Date.now();
            saveFreeAccounts(getFreeAccounts());
        } else {
            won = false; // hết acc trong kho, không thể trao dù trúng số
        }
    }

    state.spun = true;
    state.won = won;
    state.prizeCode = won && prize ? prize.code : null;
    localStorage.setItem(STORAGE_KEYS.freeSpinState, JSON.stringify(state));
    return { alreadySpun: false, won, prize };
}

// --- Mã giảm giá 5%: mỗi thiết bị chỉ dùng được đúng 1 lần, không áp dụng cho acc loại "reg" ---
function isDiscountUsed() {
    return localStorage.getItem(STORAGE_KEYS.discountState) === 'used';
}

function markDiscountUsed() {
    localStorage.setItem(STORAGE_KEYS.discountState, 'used');
}

// Kiểm tra 1 acc có được áp mã giảm 5% hay không (chưa dùng mã + không phải acc reg)
function isEligibleForDiscount(acc) {
    return !!acc && acc.type !== 'reg' && !isDiscountUsed();
}

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

// ============================================================
// LƯU TRỮ FILE NHỊ PHÂN (ảnh acc, logo, avatar, nhạc nền) — dùng IndexedDB
// thay vì localStorage vì dung lượng lớn hơn nhiều (localStorage chỉ ~5MB
// và phải mã hoá base64 tốn thêm ~33% dung lượng).
// ============================================================
const FILES_DB_NAME = 'jh_files_db';
const FILES_STORE = 'files';
let _dbPromise = null;

function openFilesDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(FILES_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FILES_STORE)) {
                db.createObjectStore(FILES_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

async function saveFileBlob(key, blob) {
    const db = await openFilesDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readwrite');
        tx.objectStore(FILES_STORE).put({ key, blob, updatedAt: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    invalidateObjectURL(key);
}

async function getFileBlob(key) {
    const db = await openFilesDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readonly');
        const req = tx.objectStore(FILES_STORE).get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

async function deleteFileBlob(key) {
    const db = await openFilesDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, 'readwrite');
        tx.objectStore(FILES_STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    invalidateObjectURL(key);
}

// Cache Object URL theo key để không tạo lại (và rò rỉ bộ nhớ) mỗi lần render
const _objectUrlCache = new Map();

async function getFileObjectURL(key) {
    if (_objectUrlCache.has(key)) return _objectUrlCache.get(key);
    const blob = await getFileBlob(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    _objectUrlCache.set(key, url);
    return url;
}

function invalidateObjectURL(key) {
    const old = _objectUrlCache.get(key);
    if (old) URL.revokeObjectURL(old);
    _objectUrlCache.delete(key);
}

// Chuyển 1 field ảnh/nhạc (có thể là URL thường hoặc "idb:key") thành src dùng được trực tiếp
async function resolveMediaSrc(field, fallback) {
    if (field && field.startsWith(IDB_PREFIX)) {
        const url = await getFileObjectURL(field.slice(IDB_PREFIX.length));
        return url || fallback;
    }
    return field || fallback;
}

// Lưu 1 File (từ <input type="file">) vào IndexedDB và trả về field dạng "idb:key" để lưu vào settings/account
async function storeUploadedFile(file, keyPrefix) {
    const key = `${keyPrefix}_${Date.now()}`;
    await saveFileBlob(key, file);
    return IDB_PREFIX + key;
}

// ============================================================
// MẬT KHẨU QUẢN TRỊ — băm SHA-256 + salt ngẫu nhiên, không còn để plaintext trong code.
// Lưu ý: đây vẫn là kiểm tra phía trình duyệt (client-side), người dùng rành kỹ thuật
// vẫn có thể sửa sessionStorage bằng DevTools để giả lập đăng nhập. Muốn bảo mật thật sự
// cần xác thực phía máy chủ (server) — xem ghi chú cuối cuộc trò chuyện.
// ============================================================
function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
    const enc = new TextEncoder().encode(salt + ':' + password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Đảm bảo luôn có 1 mật khẩu hợp lệ; nếu chưa từng đặt, khởi tạo mặc định "admin123"
async function ensureAdminPasswordInitialized() {
    const settings = getSettings();
    if (!settings.adminPasswordHash || !settings.adminPasswordSalt) {
        const salt = generateSalt();
        settings.adminPasswordSalt = salt;
        settings.adminPasswordHash = await hashPassword('admin123', salt);
        saveSettings(settings);
    }
    return settings;
}

async function verifyPassword(inputPassword) {
    const settings = await ensureAdminPasswordInitialized();
    const hash = await hashPassword(inputPassword, settings.adminPasswordSalt);
    return hash === settings.adminPasswordHash;
}

async function changeAdminPassword(newPassword) {
    const settings = getSettings();
    const salt = generateSalt();
    settings.adminPasswordSalt = salt;
    settings.adminPasswordHash = await hashPassword(newPassword, salt);
    saveSettings(settings);
}

// ============================================================
// NHẬT KÝ HOẠT ĐỘNG — ghi lại các thao tác quản trị quan trọng
// (khóa acc nghi hack, xóa, đổi trạng thái, đổi mật khẩu...)
// ============================================================
const MAX_LOG_ENTRIES = 200;

function getActivityLog() {
    const raw = localStorage.getItem(STORAGE_KEYS.activityLog);
    return raw ? JSON.parse(raw) : [];
}

function addActivityLog(action, detail) {
    const logs = getActivityLog();
    logs.unshift({ time: Date.now(), action, detail });
    if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
    localStorage.setItem(STORAGE_KEYS.activityLog, JSON.stringify(logs));
    return logs;
}

function clearActivityLog() {
    localStorage.setItem(STORAGE_KEYS.activityLog, JSON.stringify([]));
}
