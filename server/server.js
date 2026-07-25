// ============================================================
// server.js — Backend Shop J-Hush
// Lưu dữ liệu vĩnh viễn trên máy chủ (file JSON trên đĩa, có thể
// nâng cấp sang MySQL/Postgres sau này mà không đổi API phía trên).
// Chạy: npm install && npm start   (mặc định cổng 3000, đổi bằng biến môi trường PORT)
// ============================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL;

console.log(MONGO_URL);

let mongoDB;

async function connectMongo(){
    const client = new MongoClient(MONGO_URL);
    await client.connect();

    mongoDB = client.db("jhush");

    console.log("MongoDB connected");
}


const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 giờ
const WIN_PROBABILITY = 1 / 1000;
const MAX_LOG_ENTRIES = 200;
const DEFAULT_ADMIN_PASSWORD = 'admin123';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ------------------------------------------------------------
// Lớp lưu trữ: đọc toàn bộ DB vào bộ nhớ khi khởi động, mọi thay đổi
// được ghi lại xuống đĩa ngay lập tức (nối tiếp nhau, tránh ghi đè chéo).
// ------------------------------------------------------------
let db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
let saveQueue = Promise.resolve();
function persist() {

    saveQueue = saveQueue.then(async () => {

        // vẫn lưu local để backup
        await fsp.writeFile(
            DB_PATH,
            JSON.stringify(db, null, 2),
            'utf-8'
        );


        // lưu MongoDB
        if(mongoDB){

            await mongoDB.collection("shop").updateOne(
                {
                    _id:"main"
                },
                {
                    $set:db
                },
                {
                    upsert:true
                }
            );

        }

    });

    return saveQueue;
}

function getDayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function getMonthKey(d = new Date()) { return `${d.getFullYear()}-${d.getMonth() + 1}`; }

function addActivityLog(action, detail) {
    db.activityLog.unshift({ time: Date.now(), action, detail });
    if (db.activityLog.length > MAX_LOG_ENTRIES) db.activityLog.length = MAX_LOG_ENTRIES;
}

function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}
function ensureAdminPasswordInitialized() {
    if (!db.settings.adminPasswordHash || !db.settings.adminPasswordSalt) {
        const salt = generateSalt();
        db.settings.adminPasswordSalt = salt;
        db.settings.adminPasswordHash = hashPassword(DEFAULT_ADMIN_PASSWORD, salt);
        persist();
    }
}

function publicSettings(s) {
    const { adminPasswordHash, adminPasswordSalt, ...rest } = s;
    return rest;
}

// ------------------------------------------------------------
// Phiên đăng nhập Admin (token ngẫu nhiên lưu trong bộ nhớ, hết hạn sau 12h).
// Khởi động lại server sẽ buộc admin đăng nhập lại — chấp nhận được cho quy mô shop nhỏ.
// ------------------------------------------------------------
const tokens = new Map(); // token -> expiresAt
function issueToken() {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + TOKEN_TTL_MS);
    return token;
}
function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const expiresAt = token && tokens.get(token);
    if (!expiresAt || expiresAt < Date.now()) {
        if (token) tokens.delete(token);
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    }
    tokens.set(token, Date.now() + TOKEN_TTL_MS); // gia hạn khi còn hoạt động
    next();
}

// ------------------------------------------------------------
// Sự kiện: tính "đang hoạt động" = trạng thái hiển thị + đang trong khoảng thời gian
// ------------------------------------------------------------
function isEventActive(ev) {
    if (ev.status !== 'hien') return false;
    const now = Date.now();
    if (ev.startTime && now < new Date(ev.startTime).getTime()) return false;
    if (ev.endTime && now > new Date(ev.endTime).getTime()) return false;
    return true;
}
function publicEvent(ev) {
    return { ...ev, rewards: ev.rewards.map(r => ({ id: r.id, name: r.name, image: r.image, remaining: r.remaining })) };
}

// ------------------------------------------------------------
// Trạng thái theo thiết bị (mã định danh trình duyệt do client tự sinh, gửi kèm mỗi request).
// ------------------------------------------------------------
function getDeviceState(code) {
    if (!db.deviceState[code]) {
        db.deviceState[code] = { discountUsed: false, promoSpin: null, freeSpin: null, events: {} };
    }
    if (!db.deviceState[code].events) db.deviceState[code].events = {};
    return db.deviceState[code];
}

// ------------------------------------------------------------
// App
// ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Cho phép chạy giao diện frontend trong thư mục public
app.use(express.static(path.join(__dirname, "../public")));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || '').slice(0, 10);
            cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// ===================== CÔNG KHAI (KHÁCH) =====================

app.get('/api/state', (req, res) => {
    res.json({
        accounts: db.accounts,
        freeAccounts: db.freeAccounts,
        settings: publicSettings(db.settings),
        events: db.events.filter(isEventActive).map(publicEvent)
    });
});

app.get('/api/device/:code/status', (req, res) => {
    const state = getDeviceState(req.params.code);
    const monthKey = getMonthKey();
    const dayKey = getDayKey();
    const promoSpin = (state.promoSpin && state.promoSpin.month === monthKey) ? state.promoSpin : { month: monthKey, spun: false, won: false };
    const freeSpin = (state.freeSpin && state.freeSpin.day === dayKey) ? state.freeSpin : { day: dayKey, spun: false, won: false, prizeCode: null };
    res.json({ discountUsed: !!state.discountUsed, promoSpin, freeSpin, events: state.events });
});

app.post('/api/spin/promo', (req, res) => {
    const { deviceCode } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const state = getDeviceState(deviceCode);
    const monthKey = getMonthKey();
    if (!state.promoSpin || state.promoSpin.month !== monthKey) {
        state.promoSpin = { month: monthKey, spun: false, won: false };
    }
    if (state.promoSpin.spun) return res.json({ alreadySpun: true, won: state.promoSpin.won });

    const won = Math.random() < WIN_PROBABILITY;
    state.promoSpin.spun = true;
    state.promoSpin.won = won;
    persist();
    res.json({ alreadySpun: false, won });
});

app.post('/api/spin/free', (req, res) => {
    const { deviceCode } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const state = getDeviceState(deviceCode);
    const dayKey = getDayKey();
    if (!state.freeSpin || state.freeSpin.day !== dayKey) {
        state.freeSpin = { day: dayKey, spun: false, won: false, prizeCode: null };
    }
    if (state.freeSpin.spun) {
        const prize = state.freeSpin.prizeCode ? db.freeAccounts.find(a => a.code === state.freeSpin.prizeCode) : null;
        return res.json({ alreadySpun: true, won: state.freeSpin.won, prize });
    }

    let won = Math.random() < WIN_PROBABILITY;
    let prize = null;
    if (won) {
        const pool = db.freeAccounts.filter(a => !a.claimed);
        if (pool.length > 0) {
            prize = pool[Math.floor(Math.random() * pool.length)];
            prize.claimed = true;
            prize.claimedAt = Date.now();
        } else {
            won = false; // hết acc trong kho
        }
    }

    state.freeSpin.spun = true;
    state.freeSpin.won = won;
    state.freeSpin.prizeCode = won && prize ? prize.code : null;
    persist();
    res.json({ alreadySpun: false, won, prize });
});

app.post('/api/discount/use', (req, res) => {
    const { deviceCode } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const state = getDeviceState(deviceCode);
    state.discountUsed = true;
    persist();
    res.json({ ok: true });
});

// Quay vòng quay của 1 sự kiện cụ thể (mỗi sự kiện có kho phần thưởng & tỉ lệ riêng)
app.post('/api/events/:id/spin', (req, res) => {
    const { deviceCode } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const ev = db.events.find(e => e.id === req.params.id);
    if (!ev || !isEventActive(ev)) return res.status(404).json({ error: 'Sự kiện không tồn tại hoặc đã kết thúc.' });

    const state = getDeviceState(deviceCode);
    const dayKey = getDayKey();
    const evState = state.events[ev.id] && state.events[ev.id].day === dayKey
        ? state.events[ev.id]
        : { day: dayKey, spun: false, won: false, prizeId: null };

    if (evState.spun) {
        const prize = evState.prizeId ? ev.rewards.find(r => r.id === evState.prizeId) : null;
        return res.json({ alreadySpun: true, won: evState.won, prize: prize ? { id: prize.id, name: prize.name, image: prize.image } : null });
    }

    // Bốc số ngẫu nhiên theo trọng số (odds tính theo %), chỉ tính các phần thưởng còn hàng
    const random = Math.random() * 100;
    let cumulative = 0;
    let wonReward = null;
    for (const r of ev.rewards) {
        if (r.remaining <= 0) continue;
        cumulative += Number(r.odds) || 0;
        if (random < cumulative) { wonReward = r; break; }
    }

    if (wonReward) wonReward.remaining -= 1;

    evState.spun = true;
    evState.won = !!wonReward;
    evState.prizeId = wonReward ? wonReward.id : null;
    state.events[ev.id] = evState;
    persist();

    res.json({
        alreadySpun: false,
        won: !!wonReward,
        prize: wonReward ? { id: wonReward.id, name: wonReward.name, image: wonReward.image } : null
    });
});

// ===================== ĐĂNG NHẬP ADMIN =====================

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body || {};
    ensureAdminPasswordInitialized();
    const hash = hashPassword(password || '', db.settings.adminPasswordSalt);
    if (hash !== db.settings.adminPasswordHash) return res.status(401).json({ error: 'Sai mật khẩu quản trị.' });
    res.json({ token: issueToken() });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
    const token = req.headers.authorization.slice(7);
    tokens.delete(token);
    res.json({ ok: true });
});

app.post('/api/admin/change-password', requireAdmin, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const currentHash = hashPassword(currentPassword || '', db.settings.adminPasswordSalt);
    if (currentHash !== db.settings.adminPasswordHash) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });

    const salt = generateSalt();
    db.settings.adminPasswordSalt = salt;
    db.settings.adminPasswordHash = hashPassword(newPassword, salt);
    addActivityLog('Đổi mật khẩu quản trị', 'Mật khẩu đăng nhập trang quản trị đã được thay đổi.');
    persist();
    res.json({ ok: true });
});

// ===================== KHU VỰC ADMIN (yêu cầu đăng nhập) =====================

app.get('/api/admin/state', requireAdmin, (req, res) => {
    res.json({
        accounts: db.accounts,
        freeAccounts: db.freeAccounts,
        settings: publicSettings(db.settings),
        events: db.events,
        activityLog: db.activityLog
    });
});

app.post('/api/upload', requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Không có tệp nào được tải lên.' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// --- Accounts (kho acc bán) ---
app.post('/api/accounts', requireAdmin, (req, res) => {
    const acc = { id: Date.now(), ...req.body };
    db.accounts.unshift(acc);
    addActivityLog('Thêm tài khoản mới', `Đã thêm acc ${acc.code} (${acc.name}).`);
    persist();
    res.json(acc);
});

app.put('/api/accounts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.accounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    db.accounts[idx] = { ...db.accounts[idx], ...req.body, id };
    addActivityLog('Cập nhật tài khoản', `Đã cập nhật acc ${db.accounts[idx].code} (${db.accounts[idx].name}).`);
    persist();
    res.json(db.accounts[idx]);
});

app.put('/api/accounts/:id/lock', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const acc = db.accounts.find(a => a.id === id);
    if (!acc) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    const { reason } = req.body || {};
    if (acc.status === 'hacked') {
        acc.status = 'selling';
        addActivityLog('Mở khóa tài khoản', `Acc ${acc.code} (${acc.name}) đã được mở khóa, chuyển về "Đang bán".`);
    } else {
        acc.status = 'hacked';
        addActivityLog('Khóa tài khoản nghi hack', `Acc ${acc.code} (${acc.name}) đã bị khóa.${reason ? ' Lý do: ' + reason : ''}`);
    }
    persist();
    res.json(acc);
});

app.delete('/api/accounts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.accounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    const [removed] = db.accounts.splice(idx, 1);
    addActivityLog('Xóa tài khoản', `Đã xóa acc ${removed.code} (${removed.name}).`);
    persist();
    res.json({ ok: true });
});

// --- Free accounts (kho acc tặng "Quay Là Trúng") ---
app.post('/api/free-accounts', requireAdmin, (req, res) => {
    const acc = { id: Date.now(), claimed: false, claimedAt: null, ...req.body };
    db.freeAccounts.unshift(acc);
    addActivityLog('Thêm acc free', `Đã thêm acc tặng ${acc.code} (${acc.name}) vào kho Quay Là Trúng.`);
    persist();
    res.json(acc);
});

app.put('/api/free-accounts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.freeAccounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc free.' });
    db.freeAccounts[idx] = { ...db.freeAccounts[idx], ...req.body, id };
    addActivityLog('Cập nhật acc free', `Đã cập nhật acc tặng ${db.freeAccounts[idx].code}.`);
    persist();
    res.json(db.freeAccounts[idx]);
});

app.delete('/api/free-accounts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.freeAccounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc free.' });
    const [removed] = db.freeAccounts.splice(idx, 1);
    addActivityLog('Xóa acc free', `Đã xóa acc tặng ${removed.code} khỏi kho Quay Là Trúng.`);
    persist();
    res.json({ ok: true });
});

// --- Cấu hình hệ thống ---
app.put('/api/settings', requireAdmin, (req, res) => {
    const { adminPasswordHash, adminPasswordSalt, ...safeBody } = req.body || {};
    db.settings = { ...db.settings, ...safeBody, socialLinks: { ...db.settings.socialLinks, ...(safeBody.socialLinks || {}) } };
    addActivityLog('Cập nhật cấu hình hệ thống', 'Đã cập nhật thông tin chung / logo / avatar / nhạc nền / liên kết mạng xã hội.');
    persist();
    res.json(publicSettings(db.settings));
});

// --- Nhật ký hoạt động ---
app.delete('/api/activity-log', requireAdmin, (req, res) => {
    db.activityLog = [];
    persist();
    res.json({ ok: true });
});

// --- Sự kiện (mục 6): mỗi sự kiện là 1 vòng quay độc lập với kho phần thưởng riêng ---
app.post('/api/events', requireAdmin, (req, res) => {
    const ev = {
        id: 'ev_' + Date.now(),
        name: req.body.name || 'Sự kiện mới',
        type: req.body.type || 'uu_dai',
        startTime: req.body.startTime || null,
        endTime: req.body.endTime || null,
        banner: req.body.banner || '',
        description: req.body.description || '',
        status: req.body.status || 'an',
        spinPrice: Number(req.body.spinPrice) || 0,
        rewards: (req.body.rewards || []).map((r, i) => ({
            id: 'rw_' + Date.now() + '_' + i,
            name: r.name,
            image: r.image || '',
            odds: Number(r.odds) || 0,
            quantity: Number(r.quantity) || 0,
            remaining: Number(r.quantity) || 0
        })),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    db.events.unshift(ev);
    addActivityLog('Tạo sự kiện mới', `Đã tạo sự kiện "${ev.name}".`);
    persist();
    res.json(ev);
});

app.put('/api/events/:id', requireAdmin, (req, res) => {
    const ev = db.events.find(e => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });

    ev.name = req.body.name ?? ev.name;
    ev.type = req.body.type ?? ev.type;
    ev.startTime = req.body.startTime ?? ev.startTime;
    ev.endTime = req.body.endTime ?? ev.endTime;
    ev.banner = req.body.banner ?? ev.banner;
    ev.description = req.body.description ?? ev.description;
    ev.status = req.body.status ?? ev.status;
    ev.spinPrice = req.body.spinPrice != null ? Number(req.body.spinPrice) : ev.spinPrice;

    if (Array.isArray(req.body.rewards)) {
        // Giữ lại "remaining" của phần thưởng cũ (theo id) nếu vẫn còn trong danh sách mới,
        // để không cấp lại số lượng đã phát khi admin chỉ sửa nhẹ; phần thưởng mới thêm thì khởi tạo remaining = quantity.
        const oldById = new Map(ev.rewards.map(r => [r.id, r]));
        ev.rewards = req.body.rewards.map((r, i) => {
            const old = r.id && oldById.get(r.id);
            const quantity = Number(r.quantity) || 0;
            return {
                id: old ? old.id : 'rw_' + Date.now() + '_' + i,
                name: r.name,
                image: r.image || '',
                odds: Number(r.odds) || 0,
                quantity,
                remaining: old ? Math.min(old.remaining, quantity) : quantity
            };
        });
    }
    ev.updatedAt = Date.now();
    addActivityLog('Cập nhật sự kiện', `Đã cập nhật sự kiện "${ev.name}".`);
    persist();
    res.json(ev);
});

app.put('/api/events/:id/toggle', requireAdmin, (req, res) => {
    const ev = db.events.find(e => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });
    ev.status = ev.status === 'hien' ? 'an' : 'hien';
    addActivityLog('Đổi trạng thái sự kiện', `Sự kiện "${ev.name}" chuyển sang "${ev.status === 'hien' ? 'Hiển thị' : 'Ẩn'}".`);
    persist();
    res.json(ev);
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
    const idx = db.events.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });
    const [removed] = db.events.splice(idx, 1);
    addActivityLog('Xóa sự kiện', `Đã xóa sự kiện "${removed.name}".`);
    persist();
    res.json({ ok: true });
});

connectMongo().then(async ()=>{

    // load dữ liệu từ MongoDB nếu có
    const saved = await mongoDB
        .collection("shop")
        .findOne({_id:"main"});


    if(saved){

        delete saved._id;

        db = saved;

        console.log("Loaded data from MongoDB");

    } else {

        await persist();

        console.log("Created MongoDB database");

    }


    ensureAdminPasswordInitialized();


    app.listen(PORT, () => {

        console.log(
        `Shop J-Hush server đang chạy tại http://localhost:${PORT}`
        );

        console.log(
        `Mật khẩu admin mặc định: ${DEFAULT_ADMIN_PASSWORD}`
        );

    });

});
