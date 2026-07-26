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
const cloudinary = require('cloudinary').v2;

const { MongoClient, GridFSBucket, ObjectId } = require("mongodb");

// ------------------------------------------------------------
// Cloudinary: lưu ảnh/nhạc upload vĩnh viễn (không mất khi Render restart/redeploy).
// Cấu hình qua 3 biến môi trường; nếu thiếu bất kỳ biến nào, hệ thống tự
// động rơi về lưu file cục bộ (chỉ nên dùng khi chạy thử trên máy local).
// ------------------------------------------------------------
const CLOUDINARY_CONFIGURED = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (CLOUDINARY_CONFIGURED) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    console.log("Cloudinary đã cấu hình — ảnh/nhạc upload sẽ được lưu trên Cloudinary.");
} else {
    console.log("Cloudinary chưa cấu hình — ảnh/nhạc upload sẽ lưu vào MongoDB Atlas (GridFS), vẫn vĩnh viễn, không cần dịch vụ ngoài nào.");
}

const MONGO_URL = process.env.MONGO_URL;

console.log(MONGO_URL);

let mongoDB;
let gridBucket; // Bucket GridFS — lưu ảnh/nhạc trực tiếp trong MongoDB Atlas, vĩnh viễn, không phụ thuộc đĩa Render.

async function connectMongo(){
    const client = new MongoClient(MONGO_URL);
    await client.connect();

    mongoDB = client.db("jhush");
    gridBucket = new GridFSBucket(mongoDB, { bucketName: "uploads" });

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

function publicCollaborator(c) {
    const { passwordHash, passwordSalt, ...rest } = c;
    return rest;
}
function ensureCollaboratorsInitialized() {
    if (!Array.isArray(db.collaborators)) db.collaborators = [];
}

// ------------------------------------------------------------
// Phiên đăng nhập (token ngẫu nhiên lưu trong bộ nhớ, hết hạn sau 12h).
// Có 2 vai trò (role): 'admin' (toàn quyền) và 'ctv' (cộng tác viên — chỉ được
// thao tác trên Kho Tài Khoản Bán, xem requireAccountManager bên dưới).
// Khởi động lại server sẽ buộc đăng nhập lại — chấp nhận được cho quy mô shop nhỏ.
// ------------------------------------------------------------
const tokens = new Map(); // token -> { role, username, expiresAt }
function issueToken(role = 'admin', username = null) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, { role, username, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
}
function readToken(req) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const info = token && tokens.get(token);
    if (!info || info.expiresAt < Date.now()) {
        if (token) tokens.delete(token);
        return null;
    }
    info.expiresAt = Date.now() + TOKEN_TTL_MS; // gia hạn khi còn hoạt động
    return { token, info };
}
function requireAdmin(req, res, next) {
    const found = readToken(req);
    if (!found || found.info.role !== 'admin') {
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    }
    next();
}
// Cho phép cả Admin lẫn CTV — dùng cho các route Kho Tài Khoản Bán (mục duy nhất CTV được quyền thao tác)
function requireAccountManager(req, res, next) {
    const found = readToken(req);
    if (!found || (found.info.role !== 'admin' && found.info.role !== 'ctv')) {
        return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    }
    req.tokenRole = found.info.role;
    req.tokenUsername = found.info.username;
    next();
}
function actorLabel(req) {
    return req.tokenRole === 'ctv' ? `CTV "${req.tokenUsername}"` : 'Admin';
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

// Escape để chèn an toàn vào thuộc tính HTML (tránh lỗi hiển thị / chèn mã lạ nếu admin gõ ký tự đặc biệt)
function escapeHtmlAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Render động trang chủ: chèn Tiêu Đề/Mô Tả do Admin cấu hình vào thẻ <title>, <meta description>
// và Open Graph — quyết định nội dung hiện ra khi dán link vào Zalo/Facebook/Messenger, và không
// cần deploy lại code mỗi khi đổi tên/mô tả shop. Đặt TRƯỚC express.static để có hiệu lực.
app.get(['/', '/index.html'], (req, res) => {
    try {
        const filePath = path.join(__dirname, '../public/index.html');
        let html = fs.readFileSync(filePath, 'utf8');

        const title = (db.settings && db.settings.siteTitle) || 'Shop J_HUSH';
        const description = (db.settings && db.settings.siteDescription) || 'Web kết nối chính thức bởi Admin HUIDUC.';
        const logoUrl = db.settings && db.settings.logoUrl;
        const ogImage = logoUrl ? (logoUrl.startsWith('http') ? logoUrl : `${req.protocol}://${req.get('host')}${logoUrl}`) : '';
        const pageUrl = `${req.protocol}://${req.get('host')}/`;

        html = html
            .split('__SITE_TITLE__').join(escapeHtmlAttr(title))
            .split('__SITE_DESCRIPTION__').join(escapeHtmlAttr(description))
            .split('__SITE_OG_IMAGE__').join(escapeHtmlAttr(ogImage))
            .split('__SITE_URL__').join(escapeHtmlAttr(pageUrl));

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('Lỗi render trang chủ:', err);
        res.status(500).send('Lỗi tải trang.');
    }
});

// Cho phép chạy giao diện frontend trong thư mục public
app.use(express.static(path.join(__dirname, "../public")));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const upload = multer({
    // Luôn giữ file tạm trong RAM: sẽ được đẩy lên Cloudinary (nếu có cấu hình)
    // hoặc lưu vào GridFS trong chính MongoDB Atlas (mặc định) — không còn ghi ra
    // đĩa cục bộ của Render nữa, nên không còn mất ảnh khi Render redeploy/restart.
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// Upload 1 buffer lên Cloudinary, trả về Promise<secure_url>
function uploadBufferToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: 'jhush-shop', resource_type: 'auto' },
            (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(buffer);
    });
}

// Lưu 1 buffer vào GridFS (MongoDB Atlas), trả về Promise<fileId dạng chuỗi>
function uploadBufferToGridFS(buffer, filename, contentType) {
    return new Promise((resolve, reject) => {
        const uploadStream = gridBucket.openUploadStream(filename, { contentType });
        uploadStream.on('error', reject);
        uploadStream.on('finish', () => resolve(uploadStream.id.toString()));
        uploadStream.end(buffer);
    });
}

// Trả về file đã lưu trong GridFS theo id (dùng để hiển thị ảnh/phát nhạc trên trình duyệt)
//
// QUAN TRỌNG (fix lỗi không phát được nhạc trên điện thoại): trước đây route này luôn
// trả về TOÀN BỘ file với status 200, không hỗ trợ HTTP Range request. Trình duyệt trên
// PC thường vẫn phát được vì chịu tải cả file, nhưng Safari trên iPhone/iPad (và nhiều
// trình duyệt di động khác) BẮT BUỘC server phải hỗ trợ Range (trả 206 Partial Content)
// mới cho phép thẻ <audio>/<video> phát — nếu không, thẻ audio coi như không thể phát
// (không báo lỗi rõ ràng, chỉ im lặng không chạy). Giờ route trả lời đúng Range request
// để nhạc nền phát được trên mọi thiết bị, đồng thời hỗ trợ tua (seek) mượt hơn.
app.get('/files/:id', async (req, res) => {
    let objectId;
    try {
        objectId = new ObjectId(req.params.id);
    } catch (e) {
        return res.status(400).end();
    }

    try {
        const files = await gridBucket.find({ _id: objectId }).toArray();
        if (!files.length) return res.status(404).end();

        const file = files[0];
        const fileSize = file.length;
        const contentType = file.contentType || 'application/octet-stream';
        const range = req.headers.range;

        res.set('Cache-Control', 'public, max-age=604800'); // cache 7 ngày trên trình duyệt
        res.set('Accept-Ranges', 'bytes');
        res.set('Content-Type', contentType);

        if (range) {
            const match = /bytes=(\d*)-(\d*)/.exec(range);
            const start = match && match[1] ? parseInt(match[1], 10) : 0;
            const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;

            if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
                res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
                return;
            }

            const safeEnd = Math.min(end, fileSize - 1);

            res.status(206);
            res.set('Content-Range', `bytes ${start}-${safeEnd}/${fileSize}`);
            res.set('Content-Length', safeEnd - start + 1);

            gridBucket.openDownloadStream(objectId, { start, end: safeEnd + 1 })
                .on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); })
                .pipe(res);
        } else {
            res.set('Content-Length', fileSize);
            gridBucket.openDownloadStream(objectId)
                .on('error', () => { if (!res.headersSent) res.status(404).end(); else res.end(); })
                .pipe(res);
        }
    } catch (err) {
        res.status(500).end();
    }
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
    res.json({ token: issueToken('admin') });
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

app.post('/api/upload', requireAccountManager, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Không có tệp nào được tải lên.' });

    if (CLOUDINARY_CONFIGURED) {
        try {
            const result = await uploadBufferToCloudinary(req.file.buffer);
            return res.json({ url: result.secure_url });
        } catch (err) {
            console.error('Lỗi upload Cloudinary:', err);
            return res.status(500).json({ error: 'Lỗi khi tải tệp lên Cloudinary.' });
        }
    }

    // Mặc định: lưu vào GridFS (MongoDB Atlas) — vĩnh viễn, không cần tài khoản dịch vụ ngoài nào.
    try {
        const fileId = await uploadBufferToGridFS(req.file.buffer, req.file.originalname, req.file.mimetype);
        res.json({ url: `/files/${fileId}` });
    } catch (err) {
        console.error('Lỗi lưu file vào MongoDB GridFS:', err);
        res.status(500).json({ error: 'Lỗi khi lưu tệp vào cơ sở dữ liệu.' });
    }
});

// --- Accounts (kho acc bán) — Admin & CTV đều được thao tác ---
app.post('/api/accounts', requireAccountManager, (req, res) => {
    const acc = { id: Date.now(), ...req.body };
    db.accounts.unshift(acc);
    addActivityLog('Thêm tài khoản mới', `Đã thêm acc ${acc.code} (${acc.name}). [${actorLabel(req)}]`);
    persist();
    res.json(acc);
});

app.put('/api/accounts/:id', requireAccountManager, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.accounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    db.accounts[idx] = { ...db.accounts[idx], ...req.body, id };
    addActivityLog('Cập nhật tài khoản', `Đã cập nhật acc ${db.accounts[idx].code} (${db.accounts[idx].name}). [${actorLabel(req)}]`);
    persist();
    res.json(db.accounts[idx]);
});

app.put('/api/accounts/:id/lock', requireAccountManager, (req, res) => {
    const id = Number(req.params.id);
    const acc = db.accounts.find(a => a.id === id);
    if (!acc) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    const { reason } = req.body || {};
    if (acc.status === 'hacked') {
        acc.status = 'selling';
        addActivityLog('Mở khóa tài khoản', `Acc ${acc.code} (${acc.name}) đã được mở khóa, chuyển về "Đang bán". [${actorLabel(req)}]`);
    } else {
        acc.status = 'hacked';
        addActivityLog('Khóa tài khoản nghi hack', `Acc ${acc.code} (${acc.name}) đã bị khóa.${reason ? ' Lý do: ' + reason : ''} [${actorLabel(req)}]`);
    }
    persist();
    res.json(acc);
});

app.delete('/api/accounts/:id', requireAccountManager, (req, res) => {
    const id = Number(req.params.id);
    const idx = db.accounts.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy acc.' });
    const [removed] = db.accounts.splice(idx, 1);
    addActivityLog('Xóa tài khoản', `Đã xóa acc ${removed.code} (${removed.name}). [${actorLabel(req)}]`);
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

// ===================== CỘNG TÁC VIÊN (CTV) =====================
// CTV chỉ có quyền thao tác trên Kho Tài Khoản Bán (xem requireAccountManager ở trên),
// không có quyền xem/sửa cấu hình hệ thống, sự kiện, nhật ký, hay quản lý CTV khác.

// Admin tạo tài khoản CTV mới — bắt buộc xác nhận lại mật khẩu Admin (khung riêng)
app.post('/api/admin/collaborators', requireAdmin, (req, res) => {
    const { username, password, adminPassword } = req.body || {};
    const uname = String(username || '').trim();

    if (!uname || !password) return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tài khoản và mật khẩu cho CTV.' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu CTV phải có ít nhất 6 ký tự.' });

    const adminHash = hashPassword(adminPassword || '', db.settings.adminPasswordSalt);
    if (adminHash !== db.settings.adminPasswordHash) {
        return res.status(400).json({ error: 'Mật khẩu Admin xác nhận không đúng.' });
    }

    ensureCollaboratorsInitialized();
    if (db.collaborators.some(c => c.username.toLowerCase() === uname.toLowerCase())) {
        return res.status(400).json({ error: 'Tài khoản CTV này đã tồn tại.' });
    }

    const salt = generateSalt();
    const collaborator = {
        id: Date.now(),
        username: uname,
        passwordHash: hashPassword(password, salt),
        passwordSalt: salt,
        createdAt: Date.now()
    };
    db.collaborators.unshift(collaborator);
    addActivityLog('Tạo tài khoản CTV', `Admin đã tạo tài khoản cộng tác viên "${uname}".`);
    persist();
    res.json(publicCollaborator(collaborator));
});

// Admin xem danh sách CTV
app.get('/api/admin/collaborators', requireAdmin, (req, res) => {
    ensureCollaboratorsInitialized();
    res.json(db.collaborators.map(publicCollaborator));
});

// Admin xóa CTV — đồng thời hủy ngay mọi phiên đăng nhập đang mở của CTV đó
app.delete('/api/admin/collaborators/:id', requireAdmin, (req, res) => {
    ensureCollaboratorsInitialized();
    const id = Number(req.params.id);
    const idx = db.collaborators.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy CTV.' });
    const [removed] = db.collaborators.splice(idx, 1);

    for (const [tok, info] of tokens.entries()) {
        if (info.role === 'ctv' && info.username === removed.username) tokens.delete(tok);
    }

    addActivityLog('Xóa tài khoản CTV', `Admin đã xóa tài khoản cộng tác viên "${removed.username}".`);
    persist();
    res.json({ ok: true });
});

// Đăng nhập CTV — trang riêng ctv.html, chỉ cấp quyền quản lý Kho Tài Khoản Bán
app.post('/api/collaborator/login', (req, res) => {
    ensureCollaboratorsInitialized();
    const { username, password } = req.body || {};
    const uname = String(username || '').trim();
    const collaborator = db.collaborators.find(c => c.username.toLowerCase() === uname.toLowerCase());
    if (!collaborator) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });

    const hash = hashPassword(password || '', collaborator.passwordSalt);
    if (hash !== collaborator.passwordHash) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });

    res.json({ token: issueToken('ctv', collaborator.username), username: collaborator.username });
});

app.post('/api/collaborator/logout', requireAccountManager, (req, res) => {
    const token = req.headers.authorization.slice(7);
    tokens.delete(token);
    res.json({ ok: true });
});

// Dữ liệu cho trang CTV — CHỈ trả về Kho Tài Khoản Bán, không settings/sự kiện/nhật ký/CTV khác
app.get('/api/collaborator/state', requireAccountManager, (req, res) => {
    res.json({ accounts: db.accounts, role: req.tokenRole, username: req.tokenUsername });
});

// Quét toàn bộ dữ liệu để tìm các đường dẫn ảnh/nhạc kiểu CŨ (/uploads/...) — kiểu lưu trên đĩa
// Render, đã bị xóa vĩnh viễn khi Render redeploy/restart. Các mục này sẽ bị vỡ ảnh/mất nhạc
// trên MỌI thiết bị (kể cả ẩn danh) vì file gốc không còn tồn tại, khác với /files/... (GridFS)
// hoặc link Cloudinary — những kiểu lưu mới không bao giờ mất.
app.get('/api/admin/media-check', requireAdmin, (req, res) => {
    const isBroken = (val) => typeof val === 'string' && val.startsWith('/uploads/');
    const broken = [];

    db.accounts.forEach(a => {
        if (isBroken(a.img)) broken.push({ type: 'Acc đang bán', id: a.id, label: `${a.code} - ${a.name}`, field: 'img', value: a.img });
    });
    db.freeAccounts.forEach(a => {
        if (isBroken(a.img)) broken.push({ type: 'Acc Random Free', id: a.id, label: `${a.code} - ${a.name}`, field: 'img', value: a.img });
    });
    const s = db.settings;
    [['logoUrl', 'Logo Shop'], ['avatarUrl', 'Ảnh Đại Diện Admin'], ['qrImageUrl', 'Ảnh QR'], ['audioUrl', 'Nhạc Nền'], ['bgImageUrl', 'Ảnh Nền Website']].forEach(([key, label]) => {
        if (isBroken(s[key])) broken.push({ type: 'Cấu Hình Hệ Thống', id: null, label, field: key, value: s[key] });
    });
    (db.events || []).forEach(ev => {
        if (isBroken(ev.bannerUrl)) broken.push({ type: 'Sự Kiện', id: ev.id, label: ev.title || ev.name || `Sự kiện #${ev.id}`, field: 'bannerUrl', value: ev.bannerUrl });
        if (isBroken(ev.imageUrl)) broken.push({ type: 'Sự Kiện', id: ev.id, label: ev.title || ev.name || `Sự kiện #${ev.id}`, field: 'imageUrl', value: ev.imageUrl });
    });

    res.json({ broken, count: broken.length });
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
    ensureCollaboratorsInitialized();
    persist();


    app.listen(PORT, () => {

        console.log(
        `Shop J-Hush server đang chạy tại http://localhost:${PORT}`
        );

        console.log(
        `Mật khẩu admin mặc định: ${DEFAULT_ADMIN_PASSWORD}`
        );

    });

});
