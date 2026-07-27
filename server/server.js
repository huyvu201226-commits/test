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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

if (!MONGO_URL) {
    console.warn('CẢNH BÁO: Chưa cấu hình MONGO_URL trong .env — server sẽ không kết nối được MongoDB.');
}

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
// Đọc an toàn: nếu file local rỗng/không tồn tại/nội dung JSON hỏng thì dùng {} thay vì
// làm sập cả server ngay từ lúc khởi động (dữ liệu thật vẫn nạp từ MongoDB ngay sau đó,
// xem loadFromMongo() — file local chỉ là bản backup/khởi động tạm).
let db;
try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8').trim();
    db = raw ? JSON.parse(raw) : {};
} catch (err) {
    console.warn(`Không đọc được ${DB_PATH} (${err.message}) — khởi động tạm với dữ liệu rỗng, sẽ nạp lại từ MongoDB.`);
    db = {};
}
// Khởi tạo mặc định ngay từ lần đọc file local (trước khi biết có Mongo hay không) —
// đảm bảo db.eventRequests và các field mới của event luôn tồn tại kể cả khi server
// chạy tạm thời trên dữ liệu local (Mongo chưa kết nối xong).
ensureEventsInitialized();
ensureEventRequestsInitialized();
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
// Giai đoạn 2 — tầng dùng chung cho 4 sự kiện (Giảm Deal / Vòng Quay / Đập Thỏ / Đập Hộp).
// normalizeEvent() điền đầy đủ các field mới (khóa QR, giới hạn lượt chơi tổng, thông báo
// tạm khóa, tốc độ thỏ, số ô hộp...) cho MỌI sự kiện — cả sự kiện cũ (tạo trước bản cập
// nhật này) lẫn sự kiện mới tạo/sửa, để phía trước (client) luôn nhận được shape đầy đủ.
// ------------------------------------------------------------
function normalizeEvent(ev) {
    return {
        id: ev.id,
        name: ev.name || 'Sự kiện mới',
        type: ev.type || 'uu_dai', // uu_dai (Giảm Deal) | vong_quay | dap_tho | dap_hop
        startTime: ev.startTime || null,
        endTime: ev.endTime || null,
        banner: ev.banner || '',
        description: ev.description || '',
        status: ev.status || 'an', // an (ẩn hẳn) | hien (hiển thị, chơi được) | tam_khoa (hiện mờ + thông báo)
        spinPrice: Number(ev.spinPrice) || 0,
        discountPercent: Number(ev.discountPercent) || 0, // % giảm trực tiếp — dùng cho loại "Giảm Deal"
        rewards: Array.isArray(ev.rewards) ? ev.rewards : [],
        // Khóa bằng QR: khi bật, khách phải gửi yêu cầu tham gia (kèm đã chuyển khoản theo QR+số
        // tiền admin đặt) và chờ Admin duyệt trong trang quản trị mới được chơi.
        requireQr: !!ev.requireQr,
        qrAmount: Number(ev.qrAmount) || 0,
        qrNote: ev.qrNote || '',
        // Giới hạn TỔNG số lượt chơi / 1 tài khoản (thiết bị) trong suốt sự kiện — không còn
        // reset lại mỗi ngày như cơ chế cũ.
        maxPlays: ev.maxPlays != null && ev.maxPlays !== '' ? Number(ev.maxPlays) : 1,
        // Thông báo hiển thị cho khách khi sự kiện đang tạm đóng / chưa tới ngày diễn ra
        closedNoticeText: ev.closedNoticeText || 'Sự kiện hiện đang tạm đóng, vui lòng quay lại sau.',
        // Riêng "Đập Thỏ May Mắn": tốc độ thỏ nhấp nhô (ms/lần đổi ô) + số ô (giếng)
        rabbitSpeedMs: Number(ev.rabbitSpeedMs) || 800,
        rabbitHoles: Number(ev.rabbitHoles) || 6,
        // Riêng "Đập Hộp May Mắn": số hộp trong lưới
        boxCount: Number(ev.boxCount) || 6,
        createdAt: ev.createdAt || Date.now(),
        updatedAt: ev.updatedAt || Date.now()
    };
}
function ensureEventsInitialized() {
    if (!Array.isArray(db.events)) db.events = [];
    db.events = db.events.map(normalizeEvent);
}
function ensureEventRequestsInitialized() {
    if (!Array.isArray(db.eventRequests)) db.eventRequests = [];
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
// Ô "Thời gian bắt đầu/kết thúc" trong trang quản trị là <input type="datetime-local">, trả về
// chuỗi KHÔNG có múi giờ (VD "2026-07-27T09:00"). Nếu parse thẳng bằng new Date(...), Node sẽ
// hiểu chuỗi này theo múi giờ HỆ THỐNG MÁY CHỦ (thường là UTC trên các nền tảng như Render) thay
// vì giờ Việt Nam mà Admin thực sự nhập — lệch tới 7 tiếng, khiến sự kiện bị tính sai là "chưa bắt
// đầu"/"đã kết thúc" ngay trong lúc đang diễn ra theo giờ VN, làm khách không chơi được dù Admin
// thấy sự kiện đang chạy bình thường. Luôn gắn cứng offset +07:00 (giờ Việt Nam) khi parse ở đây.
function parseVnDateTime(str) {
    if (!str) return null;
    if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) return new Date(str);
    const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(str);
    return new Date(hasSeconds ? `${str}+07:00` : `${str}:00+07:00`);
}

// ------------------------------------------------------------
// Sự kiện: trạng thái hiển thị cho khách —
//   'hidden' = không hiện gì cả (status "an", hoặc đã hết thời gian kết thúc)
//   'locked' = hiện mờ + thông báo hướng dẫn (status "tam_khoa", hoặc chưa tới ngày bắt đầu) —
//              áp dụng cho 3 sự kiện tương tác (vòng quay/đập thỏ/đập hộp); sự kiện Giảm Deal
//              chỉ có 2 trạng thái hidden/active vì bản chất là bảng thông báo, không phải trò chơi.
//   'active' = hiển thị & chơi/áp dụng được bình thường
// ------------------------------------------------------------
function eventDisplayState(ev) {
    if (ev.status === 'an') return 'hidden';
    const now = Date.now();
    if (ev.endTime && now > parseVnDateTime(ev.endTime).getTime()) return 'hidden';
    if (ev.status === 'tam_khoa') return 'locked';
    if (ev.startTime && now < parseVnDateTime(ev.startTime).getTime()) return 'locked';
    return 'active';
}
// Giữ lại tên hàm cũ cho các đoạn code khác còn gọi tới (tương đương displayState === 'active')
function isEventActive(ev) {
    return eventDisplayState(ev) === 'active';
}
function publicEvent(ev) {
    return {
        ...ev,
        // Chỉ lộ ảnh/mô tả ảnh + số lượng còn lại ra ngoài — TUYỆT ĐỐI không gửi account/password
        // của phần thưởng "acc free" cho khách khi chưa trúng thưởng.
        rewards: ev.rewards.map(r => ({ id: r.id, name: r.name, image: r.image, imageDesc: r.imageDesc, remaining: r.remaining })),
        displayState: eventDisplayState(ev)
    };
}

// ------------------------------------------------------------
// Trạng thái theo thiết bị (mã định danh trình duyệt do client tự sinh, gửi kèm mỗi request).
// ------------------------------------------------------------
function getDeviceState(code) {
    if (!db.deviceState) db.deviceState = {};
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

// ------------------------------------------------------------
// Bảo mật cơ bản (helmet): thêm các HTTP header chống clickjacking, chặn dò MIME-type,
// bật HSTS... LƯU Ý: tắt hẳn Content-Security-Policy và Cross-Origin-Embedder-Policy vì
// toàn bộ giao diện đang dùng onclick="..." nội tuyến + nạp CSS/font từ cdnjs.cloudflare.com
// + nhúng iframe Google Form — bật CSP mặc định của helmet sẽ chặn ÂM THẦM tất cả các nút bấm
// và tài nguyên ngoài này (đúng kiểu lỗi "không báo gì, chỉ im lặng không chạy" đã gặp trước đó).
// Muốn bật CSP chặt hơn, cần chuyển toàn bộ onclick sang addEventListener trước.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// Giới hạn số lần thử đăng nhập: chống dò mật khẩu (brute-force) trên 2 route đăng nhập.
// Tối đa 10 lần/15 phút cho mỗi IP — vượt quá sẽ bị chặn tạm thời, không tính vào các API khác
// (VD: đồng bộ nhạc, tải dữ liệu Shop) để tránh chặn nhầm khách hàng bình thường.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Thử đăng nhập quá nhiều lần, vui lòng đợi ít phút rồi thử lại.' }
});

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
        const siteName = (db.settings && db.settings.siteName) || title;
        const promoSpinDesc = (db.settings && db.settings.promoSpinDescription) || 'Mỗi thiết bị được quay <b>1 lượt / tháng</b>, xác suất trúng phần thưởng lớn là <b>1/1000</b> (minh bạch, reset vào đầu tháng sau).';
        const freeSpinDesc = (db.settings && db.settings.freeSpinDescription) || 'Quay miễn phí, xác suất trúng acc là <b>1/1000</b>, minh bạch tuyệt đối. Mỗi thiết bị chỉ được quay <b>1 lần / ngày</b> (reset lúc 0h). Trúng thưởng là nhận thông tin acc ngay lập tức bên dưới.';
        const logoUrl = db.settings && db.settings.logoUrl;
        const ogImage = logoUrl ? (logoUrl.startsWith('http') ? logoUrl : `${req.protocol}://${req.get('host')}${logoUrl}`) : '';
        const pageUrl = `${req.protocol}://${req.get('host')}/`;

        html = html
            .split('__SITE_TITLE__').join(escapeHtmlAttr(title))
            .split('__SITE_DESCRIPTION__').join(escapeHtmlAttr(description))
            .split('__SITE_NAME__').join(escapeHtmlAttr(siteName))
            .split('__SITE_OG_IMAGE__').join(escapeHtmlAttr(ogImage))
            .split('__SITE_URL__').join(escapeHtmlAttr(pageUrl))
            .split('__PROMO_SPIN_DESC__').join(promoSpinDesc)
            .split('__FREE_SPIN_DESC__').join(freeSpinDesc);

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
        // "hidden" = status "an" hoặc đã hết hạn -> không hiện gì. Còn "locked" (tạm khóa/chưa tới
        // ngày) VẪN hiện ra nhưng ở dạng mờ + thông báo hướng dẫn, xử lý ở phía client theo displayState.
        events: db.events.filter(ev => eventDisplayState(ev) !== 'hidden').map(publicEvent)
    });
});

app.get('/api/device/:code/status', (req, res) => {
    const state = getDeviceState(req.params.code);
    const monthKey = getMonthKey();
    const dayKey = getDayKey();
    const promoSpin = (state.promoSpin && state.promoSpin.month === monthKey) ? state.promoSpin : { month: monthKey, spun: false, won: false };
    const freeSpin = (state.freeSpin && state.freeSpin.day === dayKey) ? state.freeSpin : { day: dayKey, spun: false, won: false, prizeCode: null };

    // Giai đoạn 2: mỗi sự kiện trả về {playsUsed, maxPlays, requestStatus} thay vì chỉ {day, spun, won}
    // — playsUsed/maxPlays tính TỔNG số lượt trong suốt sự kiện (không reset theo ngày), requestStatus
    // phản ánh yêu cầu tham gia (khóa QR) mới nhất: 'none' | 'pending' | 'approved' | 'rejected'.
    const events = {};
    (db.events || []).forEach(ev => {
        const evState = state.events[ev.id] || { playsUsed: 0, requestStatus: 'none' };
        events[ev.id] = {
            playsUsed: evState.playsUsed || 0,
            maxPlays: Number(ev.maxPlays) || 1,
            requestStatus: evState.requestStatus || 'none'
        };
    });

    res.json({ discountUsed: !!state.discountUsed, promoSpin, freeSpin, events });
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

    const promoRate = ((db.settings && db.settings.promoSpinRate) != null ? Number(db.settings.promoSpinRate) : (WIN_PROBABILITY * 100)) / 100;
    const won = Math.random() < promoRate;
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

    const freeRate = ((db.settings && db.settings.freeSpinRate) != null ? Number(db.settings.freeSpinRate) : (WIN_PROBABILITY * 100)) / 100;
    let won = Math.random() < freeRate;
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

// Chơi 1 lượt của sự kiện tương tác (Vòng Quay / Đập Thỏ / Đập Hộp — cả 3 dùng chung 1 tầng
// logic: bốc phần thưởng theo trọng số odds, chỉ khác giao diện hiển thị ở phía client).
// Giai đoạn 2: thay cơ chế "reset theo ngày" bằng khóa QR (nếu bật) + giới hạn TỔNG số lượt
// chơi trên toàn bộ thời gian sự kiện.
app.post('/api/events/:id/spin', (req, res) => {
    const { deviceCode } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const ev = db.events.find(e => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Sự kiện không tồn tại hoặc đã kết thúc.' });

    const display = eventDisplayState(ev);
    if (display === 'hidden') return res.status(404).json({ error: 'Sự kiện không tồn tại hoặc đã kết thúc.' });
    if (display === 'locked') {
        return res.status(423).json({
            error: 'locked',
            notice: ev.closedNoticeText || 'Sự kiện hiện đang tạm đóng, vui lòng quay lại sau.'
        });
    }

    const state = getDeviceState(deviceCode);
    const evState = state.events[ev.id] || { playsUsed: 0, requestStatus: 'none' };

    // Khóa bằng QR: bắt buộc yêu cầu tham gia được Admin duyệt trước khi được chơi
    if (ev.requireQr && evState.requestStatus !== 'approved') {
        return res.status(403).json({
            error: 'access_required',
            requestStatus: evState.requestStatus || 'none',
            qrAmount: ev.qrAmount,
            qrNote: ev.qrNote
        });
    }

    const maxPlays = Number(ev.maxPlays) || 1;
    if (evState.playsUsed >= maxPlays) {
        return res.json({ alreadySpun: true, limitReached: true, playsUsed: evState.playsUsed, maxPlays });
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

    evState.playsUsed += 1;
    state.events[ev.id] = evState;
    persist();

    // Khi trúng phần thưởng có sẵn account/password (quà acc free), trả luôn cho đúng khách vừa
    // trúng ở đây — đây là lần DUY NHẤT thông tin này rời khỏi server (không lộ qua danh sách
    // sự kiện công khai, xem publicEvent()).
    res.json({
        alreadySpun: false,
        won: !!wonReward,
        playsUsed: evState.playsUsed,
        maxPlays,
        prize: wonReward ? {
            id: wonReward.id,
            name: wonReward.name,
            image: wonReward.image,
            imageDesc: wonReward.imageDesc || '',
            account: wonReward.account || '',
            password: wonReward.password || ''
        } : null
    });
});

// Khách gửi yêu cầu tham gia sự kiện đang khóa QR (đã chuyển khoản theo QR + số tiền admin
// đặt) — yêu cầu này rơi vào trạng thái "pending" và chờ Admin duyệt trong trang quản trị.
app.post('/api/events/:id/request-access', (req, res) => {
    const { deviceCode, note } = req.body || {};
    if (!deviceCode) return res.status(400).json({ error: 'Thiếu deviceCode' });
    const ev = db.events.find(e => e.id === req.params.id);
    if (!ev) return res.status(404).json({ error: 'Sự kiện không tồn tại.' });
    if (!ev.requireQr) return res.status(400).json({ error: 'Sự kiện này không yêu cầu duyệt truy cập.' });

    const state = getDeviceState(deviceCode);
    const evState = state.events[ev.id] || { playsUsed: 0, requestStatus: 'none' };

    if (evState.requestStatus === 'pending') return res.json({ ok: true, requestStatus: 'pending' });
    if (evState.requestStatus === 'approved') return res.json({ ok: true, requestStatus: 'approved' });

    ensureEventRequestsInitialized();
    const reqEntry = {
        id: 'evreq_' + Date.now(),
        eventId: ev.id,
        eventName: ev.name,
        deviceCode,
        note: note ? String(note).slice(0, 300) : '',
        status: 'pending',
        createdAt: Date.now(),
        resolvedAt: null
    };
    db.eventRequests.unshift(reqEntry);
    evState.requestStatus = 'pending';
    state.events[ev.id] = evState;
    addActivityLog('Yêu cầu tham gia sự kiện', `Thiết bị ${deviceCode} yêu cầu tham gia sự kiện "${ev.name}".`);
    persist();
    res.json({ ok: true, requestStatus: 'pending' });
});

// ===================== ĐĂNG NHẬP ADMIN =====================

app.post('/api/admin/login', loginLimiter, (req, res) => {
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
    ensureEventRequestsInitialized();
    res.json({
        accounts: db.accounts,
        freeAccounts: db.freeAccounts,
        settings: publicSettings(db.settings),
        events: db.events,
        eventRequests: db.eventRequests,
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
app.post('/api/collaborator/login', loginLimiter, (req, res) => {
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
    const rewards = (req.body.rewards || []).map((r, i) => ({
        id: 'rw_' + Date.now() + '_' + i,
        name: r.name,
        image: r.image || '',
        imageDesc: r.imageDesc || '', // mô tả ảnh dùng khi không có link ảnh
        odds: Number(r.odds) || 0,
        quantity: Number(r.quantity) || 0,
        remaining: Number(r.quantity) || 0,
        // Tài khoản/mật khẩu của quà acc free — chỉ trả về cho khách khi trúng (xem /spin), không
        // bao giờ lộ qua publicEvent()
        account: r.account || '',
        password: r.password || ''
    }));
    const ev = normalizeEvent({
        ...req.body,
        id: 'ev_' + Date.now(),
        rewards,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
    db.events.unshift(ev);
    addActivityLog('Tạo sự kiện mới', `Đã tạo sự kiện "${ev.name}".`);
    persist();
    res.json(ev);
});

app.put('/api/events/:id', requireAdmin, (req, res) => {
    const idx = db.events.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy sự kiện.' });
    const ev = db.events[idx];

    let rewards = ev.rewards;
    if (Array.isArray(req.body.rewards)) {
        // Giữ lại "remaining" của phần thưởng cũ (theo id) nếu vẫn còn trong danh sách mới,
        // để không cấp lại số lượng đã phát khi admin chỉ sửa nhẹ; phần thưởng mới thêm thì khởi tạo remaining = quantity.
        const oldById = new Map(ev.rewards.map(r => [r.id, r]));
        rewards = req.body.rewards.map((r, i) => {
            const old = r.id && oldById.get(r.id);
            const quantity = Number(r.quantity) || 0;
            return {
                id: old ? old.id : 'rw_' + Date.now() + '_' + i,
                name: r.name,
                image: r.image || '',
                imageDesc: r.imageDesc || '',
                odds: Number(r.odds) || 0,
                quantity,
                remaining: old ? Math.min(old.remaining, quantity) : quantity,
                account: r.account || '',
                password: r.password || ''
            };
        });
    }

    const merged = normalizeEvent({
        ...ev,
        ...req.body,
        rewards,
        id: ev.id,
        createdAt: ev.createdAt,
        updatedAt: Date.now()
    });
    db.events[idx] = merged;
    addActivityLog('Cập nhật sự kiện', `Đã cập nhật sự kiện "${merged.name}".`);
    persist();
    res.json(merged);
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

// --- Yêu cầu tham gia sự kiện (khóa QR) — Admin xem & duyệt/từ chối ---
app.get('/api/admin/event-requests', requireAdmin, (req, res) => {
    ensureEventRequestsInitialized();
    res.json(db.eventRequests);
});

app.put('/api/admin/event-requests/:id/approve', requireAdmin, (req, res) => {
    ensureEventRequestsInitialized();
    const reqEntry = db.eventRequests.find(r => r.id === req.params.id);
    if (!reqEntry) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });

    reqEntry.status = 'approved';
    reqEntry.resolvedAt = Date.now();
    const state = getDeviceState(reqEntry.deviceCode);
    const evState = state.events[reqEntry.eventId] || { playsUsed: 0, requestStatus: 'none' };
    evState.requestStatus = 'approved';
    state.events[reqEntry.eventId] = evState;
    addActivityLog('Duyệt yêu cầu tham gia sự kiện', `Đã duyệt thiết bị ${reqEntry.deviceCode} tham gia sự kiện "${reqEntry.eventName}".`);
    persist();
    res.json(reqEntry);
});

app.put('/api/admin/event-requests/:id/reject', requireAdmin, (req, res) => {
    ensureEventRequestsInitialized();
    const reqEntry = db.eventRequests.find(r => r.id === req.params.id);
    if (!reqEntry) return res.status(404).json({ error: 'Không tìm thấy yêu cầu.' });

    reqEntry.status = 'rejected';
    reqEntry.resolvedAt = Date.now();
    const state = getDeviceState(reqEntry.deviceCode);
    const evState = state.events[reqEntry.eventId] || { playsUsed: 0, requestStatus: 'none' };
    evState.requestStatus = 'rejected';
    state.events[reqEntry.eventId] = evState;
    addActivityLog('Từ chối yêu cầu tham gia sự kiện', `Đã từ chối thiết bị ${reqEntry.deviceCode} tham gia sự kiện "${reqEntry.eventName}".`);
    persist();
    res.json(reqEntry);
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
    // Dù db đến từ MongoDB (đã tồn tại) hay vừa được tạo mới, luôn đảm bảo mỗi event có
    // đầy đủ field mới của Giai đoạn 2 và db.eventRequests tồn tại.
    ensureEventsInitialized();
    ensureEventRequestsInitialized();
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
