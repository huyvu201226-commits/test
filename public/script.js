// ============================================================
// script.js — Logic trang khách hàng
// Yêu cầu: data.js phải được nạp trước file này.
// Toàn bộ dữ liệu giờ lấy từ máy chủ (API) thay vì localStorage.
// ============================================================

const CLIENT_STATUS_LABELS = {
    selling: { badge: '<span class="acc-status-badge badge-selling">Đang bán</span>', disabled: false, btnText: 'Mua Ngay' },
    sold: { badge: '<span class="acc-status-badge badge-sold">Đã bán</span>', disabled: true, btnText: 'Không Khả Dụng' },
    banned: { badge: '<span class="acc-status-badge badge-banned">Bị ban</span>', disabled: true, btnText: 'Không Khả Dụng' },
    hacked: { badge: '<span class="acc-status-badge badge-hacked">Tạm Khóa (Nghi Hack)</span>', disabled: true, btnText: 'Đang Tạm Khóa' }
};

let _deviceStatus = { discountUsed: false, promoSpin: { spun: false, won: false }, freeSpin: { spun: false, won: false, prizeCode: null }, events: {} };

// Promise của lần nạp cấu hình đầu tiên — enterWebsite() cần đợi cái này xong (nếu chưa xong)
// trước khi phát nhạc, vì trên điện thoại thao tác play() chỉ được phép ngay trong/khá gần
// cử chỉ chạm của người dùng; nếu audio.src chưa kịp có do mạng chậm thì play() sẽ không làm gì cả.
let clientDataReadyPromise = null;

// Chạy khi tải trang xong
document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.getElementById('accountGrid');
    try {
        clientDataReadyPromise = initClientData();
        await clientDataReadyPromise;
        _deviceStatus = await getDeviceStatus();
    } catch (err) {
        console.error('Không thể tải dữ liệu từ máy chủ:', err);
        if (grid) grid.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1;">Không thể kết nối máy chủ. Vui lòng thử tải lại trang sau ít phút.</p>';
    }

    loadSettingsToClient();
    renderAccounts(getAccounts());
    initAudioPlayer();
    checkDeviceDiscountCode();
    bindShopGridEvents();     // event delegation: 1 listener duy nhất thay vì N onclick nội tuyến
    bindSearchDebounce();     // tránh render lại toàn bộ lưới trên mỗi phím gõ
    renderPromoWheelStatus(); // trạng thái vòng quay ưu đãi (1 lượt/tháng/thiết bị)
    renderFreeSpinStatus();   // trạng thái vòng quay acc random free (1 lượt/ngày/thiết bị)
    renderShopEventBanners(); // banner sự kiện đang hoạt động (tab Shop)
    renderEventWheels();      // vòng quay riêng cho từng sự kiện (tab Quay Là Trúng)
    startMusicSync();         // tự động cập nhật nhạc nền khi admin đổi, không cần tải lại trang
});

// ------------------------------------------------------------
// Đồng bộ nhạc nền định kỳ: settings chỉ được nạp 1 lần lúc vào trang, nên nếu admin
// đổi nhạc trong khi khách vẫn đang mở trang thì khách sẽ không nghe được nhạc mới cho
// tới khi tải lại trang. Hàm này định kỳ hỏi máy chủ và tự cập nhật thẻ audio khi có
// đường dẫn nhạc mới, giữ nguyên trạng thái đang phát/tạm dừng nếu có thể.
// ------------------------------------------------------------
const MUSIC_SYNC_INTERVAL_MS = 15000;
function startMusicSync() {
    setInterval(async () => {
        try {
            const settings = await apiFetch('/api/settings');
            const newAudioUrl = settings && settings.audioUrl;
            if (newAudioUrl !== _settingsCache.audioUrl) {
                _settingsCache = { ..._settingsCache, ...settings };
                applyAudioSource(newAudioUrl);
            }
        } catch (err) {
            console.log('Không thể đồng bộ nhạc nền mới nhất:', err);
        }
    }, MUSIC_SYNC_INTERVAL_MS);
}

// Áp dụng đường dẫn nhạc nền mới vào thẻ audio, giữ nguyên trạng thái phát nếu đang phát
function applyAudioSource(newAudioUrl) {
    const audio = document.getElementById('bgAudio');
    const btn = document.getElementById('btnPlayMusic');
    if (!audio) return;

    const wasPlaying = isPlayingMusic && !audio.paused;
    const audioSrc = resolveMediaSrc(newAudioUrl, '');
    audio.src = audioSrc;

    if (audioSrc && wasPlaying) {
        audio.play().catch(e => console.log("Trình duyệt chặn autoplay âm thanh:", e));
    } else if (!audioSrc) {
        isPlayingMusic = false;
        if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i> Phát/Tạm dừng nhạc';
    }
}

// Tải cấu hình cài đặt từ Admin lên Client (logo, avatar, nhạc, social links, giới thiệu)
function loadSettingsToClient() {
    const settings = getSettings();
    const titleEl = document.getElementById('introAdminTitle');
    const introEl = document.getElementById('displayIntroText');
    const audio = document.getElementById('bgAudio');

    if (titleEl) titleEl.textContent = settings.adminTitle;
    if (introEl) introEl.innerHTML = settings.introText;

    const logoSrc = resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO);
    const avatarSrc = resolveMediaSrc(settings.avatarUrl, DEFAULT_LOGO);
    const audioSrc = resolveMediaSrc(settings.audioUrl, '');

    const welcomeLogo = document.getElementById('welcomeLogoImg');
    const navbarLogo = document.getElementById('navbarLogoImg');
    const introAvatar = document.getElementById('introAvatarImg');
    if (welcomeLogo) welcomeLogo.src = logoSrc;
    if (navbarLogo) navbarLogo.src = logoSrc;
    if (introAvatar) introAvatar.src = avatarSrc;
    if (audio && audioSrc) audio.src = audioSrc;

    applySocialLinks(settings.socialLinks || {});
}

// Cập nhật các nút liên kết mạng xã hội theo cấu hình admin
function applySocialLinks(links) {
    const tiktok = document.getElementById('socialTiktok');
    const youtube = document.getElementById('socialYoutube');
    const zalo = document.getElementById('socialZalo');
    const facebook = document.getElementById('socialFacebook');

    if (tiktok && links.tiktok) tiktok.href = links.tiktok;
    if (youtube && links.youtube) youtube.href = links.youtube;
    if (zalo && links.zalo) zalo.href = links.zalo;

    if (facebook) {
        if (links.facebook) {
            facebook.href = links.facebook;
            facebook.target = '_blank';
            facebook.onclick = null;
            facebook.innerHTML = '<i class="fa-brands fa-facebook"></i> Facebook';
        } else {
            facebook.href = '#';
            facebook.removeAttribute('target');
            facebook.onclick = (e) => { e.preventDefault(); alert('Hiện tại face mk không dùng được ae thông cảm nhé😅'); };
            facebook.innerHTML = '<i class="fa-brands fa-facebook"></i> Facebook (Tạm khóa)';
        }
    }
}

// Xử lý màn hình chào mừng (Mở trang & Phát nhạc)
// LƯU Ý: trên điện thoại, trình duyệt chỉ cho phép audio.play() chạy khi được gọi ngay
// trong lúc xử lý cử chỉ chạm của người dùng. Trước đây hàm này kiểm tra audio.src ngay lập
// tức — nếu cấu hình (nhạc nền) chưa kịp tải xong (mạng di động thường chậm hơn), audio.src
// vẫn rỗng nên play() không làm gì, và không có cơ hội thử lại => vào bằng điện thoại
// thường xuyên bị mất tiếng. Giờ hàm đợi nốt phần cấu hình đang tải (nếu còn dang dở) trước
// khi gán src & phát, để không bỏ lỡ nhạc chỉ vì tải chậm.
async function enterWebsite() {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.classList.add('hidden');

    const audio = document.getElementById('bgAudio');
    if (!audio) return;

    if (clientDataReadyPromise) {
        try { await clientDataReadyPromise; } catch (e) { /* lỗi tải dữ liệu đã được báo ở nơi khác */ }
    }

    if (!audio.src) {
        const audioSrc = resolveMediaSrc(getSettings().audioUrl, '');
        if (audioSrc) audio.src = audioSrc;
    }

    if (audio.src) {
        audio.play().then(() => {
            isPlayingMusic = true;
            const btn = document.getElementById('btnPlayMusic');
            if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i> Đang phát nhạc...';
        }).catch(e => console.log("Trình duyệt chặn autoplay âm thanh:", e));
    }
}

// Chuyển đổi Tab (SPA Router)
function switchTab(tabId, el) {
    document.querySelectorAll('.page-tab.active').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-link.active').forEach(link => link.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    if (el) el.classList.add('active');
}

// Chuyển hướng nhanh từ huy hiệu "Ưu đãi 5%" (tab Giới Thiệu) sang tab Ưu Đãi
function goToPromoTab() {
    switchTab('promoTab', document.querySelectorAll('.nav-link')[0]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Chuyển đổi Giao diện Sáng / Tối
function toggleTheme() {
    document.body.classList.toggle('light-theme');
    const btn = document.getElementById('themeToggleBtn');
    const isLight = document.body.classList.contains('light-theme');
    btn.innerHTML = isLight
        ? '<i class="fa-solid fa-moon"></i> Tối'
        : '<i class="fa-solid fa-sun"></i> Sáng';
}

// Quản lý Trình phát nhạc nền
let isPlayingMusic = false;
function initAudioPlayer() {
    const audio = document.getElementById('bgAudio');
    const progressBar = document.getElementById('audioProgressBar');
    const timeDisplay = document.getElementById('audioTimeDisplay');
    if (!audio) return;

    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        if (progressBar) progressBar.style.width = `${progressPercent}%`;

        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        }
    });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function togglePlayMusic() {
    const audio = document.getElementById('bgAudio');
    const btn = document.getElementById('btnPlayMusic');
    if (!audio || !audio.src) { alert("Chưa có tệp nhạc nào được cấu hình!"); return; }

    if (isPlayingMusic) {
        audio.pause();
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Phát/Tạm dừng nhạc';
        isPlayingMusic = false;
    } else {
        audio.play().then(() => {
            btn.innerHTML = '<i class="fa-solid fa-pause"></i> Đang phát nhạc...';
            isPlayingMusic = true;
        }).catch(() => alert("Không thể phát tệp âm thanh này!"));
    }
}

function seekAudio(event) {
    const audio = document.getElementById('bgAudio');
    const container = document.querySelector('.progress-container');
    if (!audio || !audio.duration || !container) return;

    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    audio.currentTime = (clickX / rect.width) * audio.duration;
}

// Xử lý hiển thị mã giảm giá thiết bị: mã chỉ dùng được 1 lần / thiết bị, không áp cho acc Reg
function checkDeviceDiscountCode() {
    const deviceCode = getOrCreateDeviceCode();
    const display = document.getElementById('discountCodeDisplay');
    if (!display) return;
    display.textContent = _deviceStatus.discountUsed
        ? `Mã định danh: ${deviceCode} (Đã sử dụng ưu đãi 5%)`
        : `Mã định danh: ${deviceCode} (Còn hiệu lực giảm 5%, không áp dụng cho Acc Reg)`;
}

function claimDiscountCode() {
    const code = getOrCreateDeviceCode();
    navigator.clipboard.writeText(code);
    if (_deviceStatus.discountUsed) {
        alert(`Mã ${code} đã được sử dụng trên thiết bị này rồi. Mỗi thiết bị chỉ được áp dụng ưu đãi 5% một lần duy nhất.`);
    } else {
        alert(`Đã sao chép mã giảm giá: ${code}. Ưu đãi 5% sẽ tự động áp khi bạn mua acc (trừ Acc Reg)!`);
    }
}

// ============================================================
// Vòng quay may mắn (tab Ưu Đãi) — xác suất trúng thật 1/1000, 1 lượt / thiết bị / tháng.
// Kết quả do MÁY CHỦ quyết định (chống gian lận), trình duyệt chỉ hiển thị hiệu ứng quay.
// ============================================================
let isSpinning = false;

function renderPromoWheelStatus() {
    const state = _deviceStatus.promoSpin;
    const btn = document.getElementById('promoSpinBtn');
    const status = document.getElementById('promoWheelStatus');
    if (!btn || !status) return;

    if (state.spun) {
        btn.disabled = true;
        status.textContent = state.won
            ? 'Bạn đã trúng thưởng tháng này! Liên hệ Zalo Admin để nhận. Lượt quay mới sẽ mở vào đầu tháng sau.'
            : 'Bạn đã dùng lượt quay của tháng này. Hẹn gặp lại vào đầu tháng sau nhé!';
    } else {
        btn.disabled = false;
        status.textContent = 'Bạn còn 1 lượt quay trong tháng này.';
    }
}

async function spinWheel() {
    if (isSpinning) return;
    if (_deviceStatus.promoSpin.spun) { renderPromoWheelStatus(); return; }

    isSpinning = true;
    const btn = document.getElementById('promoSpinBtn');
    if (btn) btn.disabled = true;
    const wheel = document.getElementById('wheelCircle');

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    try {
        const result = await spinPromoWheelApi(); // máy chủ quyết định thắng/thua, chỉ tiêu tốn lượt đúng 1 lần
        setTimeout(() => {
            isSpinning = false;
            _deviceStatus.promoSpin = { ..._deviceStatus.promoSpin, spun: true, won: result.won };
            if (result.won) {
                alert("🎉 Chúc mừng! Bạn đã may mắn trúng phần thưởng lớn từ Shop J-Hush! Hãy liên hệ Zalo Admin để nhận thưởng.");
            } else {
                alert("Chúc bạn may mắn lần sau! Mỗi thiết bị có 1 lượt quay mỗi tháng, hẹn gặp lại vào tháng sau.");
            }
            renderPromoWheelStatus();
        }, 4000);
    } catch (err) {
        isSpinning = false;
        if (btn) btn.disabled = false;
        alert('Không thể kết nối máy chủ để quay thưởng, vui lòng thử lại: ' + err.message);
    }
}

// ============================================================
// Vòng quay "Quay Là Trúng" (trang riêng) — xác suất trúng thật 1/1000, 1 lượt / thiết bị / ngày.
// Trúng thưởng thì hiển thị thông tin acc minh bạch ngay lập tức.
// ============================================================
let isFreeSpinning = false;

function renderFreeSpinStatus() {
    const state = _deviceStatus.freeSpin;
    const btn = document.getElementById('freeSpinBtn');
    const status = document.getElementById('freeSpinStatus');
    if (!btn || !status) return;

    if (state.spun) {
        btn.disabled = true;
        status.textContent = state.won
            ? 'Bạn đã quay trúng acc hôm nay! Xem thông tin bên dưới. Lượt quay mới mở vào 0h ngày mai.'
            : 'Bạn đã dùng lượt quay hôm nay. Quay lại vào ngày mai nhé!';
        if (state.won && state.prizeCode) {
            const prize = getFreeAccounts().find(a => a.code === state.prizeCode);
            if (prize) showFreeAccPrize(prize);
        }
    } else {
        btn.disabled = false;
        status.textContent = 'Bạn còn 1 lượt quay hôm nay.';
        const box = document.getElementById('freeAccPrizeBox');
        if (box) box.style.display = 'none';
    }
}

function showFreeAccPrize(prize) {
    const box = document.getElementById('freeAccPrizeBox');
    if (!box) return;
    document.getElementById('freeAccPrizeImg').src = prize.img || DEFAULT_LOGO;
    document.getElementById('freeAccPrizeName').textContent = prize.name;
    document.getElementById('freeAccPrizeCode').textContent = `Mã acc: ${prize.code}`;
    document.getElementById('freeAccPrizeInfo').textContent = prize.info || '';
    document.getElementById('freeAccPrizeDesc').textContent = prize.description || '';
    box.style.display = 'block';
}

async function spinFreeWheel() {
    if (isFreeSpinning) return;
    if (_deviceStatus.freeSpin.spun) { renderFreeSpinStatus(); return; }

    isFreeSpinning = true;
    const btn = document.getElementById('freeSpinBtn');
    if (btn) btn.disabled = true;
    const wheel = document.getElementById('freeWheelCircle');

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    try {
        const result = await spinFreeAccountApi(); // máy chủ quyết định thắng/thua, minh bạch
        setTimeout(() => {
            isFreeSpinning = false;
            _deviceStatus.freeSpin = { ..._deviceStatus.freeSpin, spun: true, won: result.won, prizeCode: result.prize ? result.prize.code : null };
            if (result.won && result.prize) {
                alert(`🎉 Chúc mừng! Bạn đã quay trúng acc [${result.prize.code}] miễn phí! Thông tin acc đã hiển thị bên dưới.`);
                showFreeAccPrize(result.prize);
            } else {
                alert("Chúc bạn may mắn lần sau! Mỗi thiết bị có 1 lượt quay mỗi ngày, hẹn gặp lại ngày mai.");
            }
            renderFreeSpinStatus();
        }, 4000);
    } catch (err) {
        isFreeSpinning = false;
        if (btn) btn.disabled = false;
        alert('Không thể kết nối máy chủ để quay thưởng, vui lòng thử lại: ' + err.message);
    }
}

// ============================================================
// SỰ KIỆN (mục 6) — mỗi sự kiện admin tạo sẽ tự sinh 1 banner ở tab Shop
// và 1 vòng quay độc lập ở tab "Quay Là Trúng".
// ============================================================
function renderShopEventBanners() {
    const container = document.getElementById('shopEventsBanner');
    if (!container) return;
    const events = getEvents();
    if (events.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = events.map(ev => `
        <div class="hover-card" style="padding:16px; display:flex; align-items:center; gap:14px; cursor:pointer; margin-bottom:14px;"
             onclick="switchTab('randomTab', document.querySelectorAll('.nav-link')[1]); window.scrollTo({top:0,behavior:'smooth'});">
            ${ev.banner ? `<img src="${escapeHtml(resolveMediaSrc(ev.banner, DEFAULT_LOGO))}" alt="${escapeHtml(ev.name)}" loading="lazy" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;">` : `<i class="fa-solid fa-gift icon-flame-anim" style="font-size:2rem;color:var(--gold);flex-shrink:0;"></i>`}
            <div>
                <div style="font-weight:800;">${escapeHtml(ev.name)} <span class="promo-5-badge" style="margin:0 0 0 6px; padding:2px 10px; font-size:0.7rem;">${escapeHtml(EVENT_TYPE_LABELS[ev.type] || 'Sự kiện')}</span></div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">${escapeHtml(ev.description || 'Bấm để sang vòng quay sự kiện!')}</div>
            </div>
        </div>
    `).join('');
}

let _spinningEvents = {};

function renderEventWheels() {
    const container = document.getElementById('eventWheelsContainer');
    if (!container) return;
    const events = getEvents();
    if (events.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = events.map(ev => {
        const state = (_deviceStatus.events && _deviceStatus.events[ev.id]) || { spun: false, won: false };
        const sliceClasses = ['slice-1', 'slice-2', 'slice-3', 'slice-4', 'slice-5', 'slice-6'];
        const wheelSlices = ev.rewards.slice(0, 6).map((r, i) => `<div class="wheel-slice ${sliceClasses[i % 6]}"><span>${escapeHtml(r.name.slice(0, 10))}</span></div>`).join('');
        return `
        <div class="hover-card promo-box" style="margin-top:20px;">
            <i class="fa-solid fa-star icon-wheel-anim" style="font-size: 2.2rem; color: var(--gold); margin-bottom: 10px;"></i>
            <h3>${escapeHtml(ev.name)}</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; margin: 8px 0 15px;">${escapeHtml(ev.description || '')}</p>
            <div class="wheel-container">
                <div class="wheel-pointer"></div>
                <div class="wheel-circle" id="eventWheel_${ev.id}">${wheelSlices}</div>
            </div>
            <p id="eventStatus_${ev.id}" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 12px;">
                ${state.spun ? (state.won ? 'Bạn đã trúng thưởng sự kiện này hôm nay! Liên hệ Zalo Admin để nhận.' : 'Bạn đã dùng lượt quay sự kiện hôm nay, hẹn gặp lại ngày mai.') : 'Bạn còn 1 lượt quay sự kiện hôm nay.'}
            </p>
            <button class="btn-submit pulse-anim" style="margin-top: 15px;" ${state.spun ? 'disabled' : ''} onclick="spinEventWheelUI('${ev.id}')" id="eventSpinBtn_${ev.id}">Quay Sự Kiện</button>
        </div>`;
    }).join('');
}

async function spinEventWheelUI(eventId) {
    if (_spinningEvents[eventId]) return;
    const state = (_deviceStatus.events && _deviceStatus.events[eventId]) || { spun: false };
    if (state.spun) return;

    _spinningEvents[eventId] = true;
    const btn = document.getElementById(`eventSpinBtn_${eventId}`);
    const wheel = document.getElementById(`eventWheel_${eventId}`);
    const status = document.getElementById(`eventStatus_${eventId}`);
    if (btn) btn.disabled = true;

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    if (wheel) wheel.style.transform = `rotate(${randomDeg}deg)`;

    try {
        const result = await spinEventWheelApi(eventId);
        setTimeout(() => {
            _spinningEvents[eventId] = false;
            if (!_deviceStatus.events) _deviceStatus.events = {};
            _deviceStatus.events[eventId] = { spun: true, won: result.won };
            if (result.won && result.prize) {
                alert(`🎉 Chúc mừng! Bạn đã trúng "${result.prize.name}" từ sự kiện! Liên hệ Zalo Admin để nhận thưởng.`);
                if (status) status.textContent = 'Bạn đã trúng thưởng sự kiện này hôm nay! Liên hệ Zalo Admin để nhận.';
            } else {
                alert('Chúc bạn may mắn lần sau! Hẹn gặp lại ngày mai.');
                if (status) status.textContent = 'Bạn đã dùng lượt quay sự kiện hôm nay, hẹn gặp lại ngày mai.';
            }
        }, 4000);
    } catch (err) {
        _spinningEvents[eventId] = false;
        if (btn) btn.disabled = false;
        alert('Không thể kết nối máy chủ để quay thưởng: ' + err.message);
    }
}

// Hiển thị danh sách tài khoản (dùng DocumentFragment để giảm số lần reflow)
function renderAccounts(accountsToRender) {
    const grid = document.getElementById('accountGrid');
    if (!grid) return;

    if (accountsToRender.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1;">Không tìm thấy tài khoản phù hợp.</p>';
        return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300';
    const fragment = document.createDocumentFragment();

    accountsToRender.forEach((acc) => {
        const statusInfo = CLIENT_STATUS_LABELS[acc.status] || CLIENT_STATUS_LABELS.selling;
        const typeInfo = ACCOUNT_TYPE_LABELS[acc.type] || ACCOUNT_TYPE_LABELS.reg;

        const card = document.createElement('div');
        card.className = 'acc-card hover-card';
        card.innerHTML = `
            <div class="acc-img-wrap">
                <img src="${escapeHtml(resolveMediaSrc(acc.img, fallbackImg))}" alt="Ảnh acc ${escapeHtml(acc.code)}" loading="lazy">
                ${statusInfo.badge}
            </div>
            <div class="acc-body">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="acc-code">${escapeHtml(acc.code)}</span>
                    <span class="type-pill ${typeInfo.badge}">${typeInfo.text}</span>
                </div>
                <h4 class="acc-title">${escapeHtml(acc.name)}</h4>
                ${acc.info ? `<div style="font-size:0.8rem; color: var(--text-muted);">${escapeHtml(acc.info)}</div>` : ''}
                <div class="acc-price">${formatVND(acc.price)}</div>
                <button class="btn-action-acc" ${statusInfo.disabled ? 'disabled' : ''} data-code="${escapeHtml(acc.code)}">
                    ${statusInfo.btnText}
                </button>
            </div>
        `;
        fragment.appendChild(card);
    });

    grid.innerHTML = '';
    grid.appendChild(fragment);
}

// Một listener duy nhất trên lưới thay vì gắn onclick cho từng nút (nhanh hơn khi có nhiều acc)
function bindShopGridEvents() {
    const grid = document.getElementById('accountGrid');
    if (!grid) return;
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-action-acc');
        if (!btn || btn.disabled) return;
        openBuyModal(btn.dataset.code);
    });
}

// Bộ lọc tìm kiếm, mức giá và loại acc — 3 điều kiện độc lập, kết hợp với nhau (AND)
let currentPriceFilter = 'all';
let currentTypeFilter = 'all';

function applyAllFilters() {
    const keyword = (document.getElementById('searchInput').value || '').toLowerCase().trim();
    const accounts = getAccounts();

    const filtered = accounts.filter(acc => {
        const matchKeyword = acc.name.toLowerCase().includes(keyword) || acc.code.toLowerCase().includes(keyword);
        const matchPrice = currentPriceFilter === 'all' || acc.category === currentPriceFilter;
        const matchType = currentTypeFilter === 'all' || acc.type === currentTypeFilter;
        return matchKeyword && matchPrice && matchType;
    });
    renderAccounts(filtered);
}

function filterAccounts() {
    applyAllFilters();
}

// Debounce input tìm kiếm: chỉ render lại sau khi người dùng ngừng gõ ~250ms,
// tránh render lại toàn bộ lưới trên từng phím bấm.
function bindSearchDebounce() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(filterAccounts, 250);
    });
}

function setPriceFilter(category, btnElement) {
    document.querySelectorAll('.btn-preset[data-filter-group="price"].active').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    currentPriceFilter = category;
    applyAllFilters();
}

function setTypeFilter(type, btnElement) {
    document.querySelectorAll('.btn-preset[data-filter-group="type"].active').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    currentTypeFilter = type;
    applyAllFilters();
}

// Modal thanh toán
let currentBuyingCode = '';
let currentBuyingPrice = 0;
let currentDiscountApplied = false;

// Nhận vào mã acc, tự tra cứu đầy đủ dữ liệu (thông tin, mô tả, loại, giá) để hiển thị
// tách biệt "thông tin acc" và "mô tả acc" thay vì gộp chung, đồng thời tự áp mã giảm 5%
// (nếu thiết bị còn hiệu lực và acc không phải loại Reg) và dùng QR admin tự tải lên nếu có.
function openBuyModal(code) {
    const acc = getAccounts().find(a => a.code === code);
    if (!acc) return;

    currentBuyingCode = acc.code;

    const eligibleDiscount = isEligibleForDiscount(acc, _deviceStatus.discountUsed);
    currentDiscountApplied = eligibleDiscount;
    const finalPrice = eligibleDiscount ? Math.round(acc.price * 0.95) : acc.price;
    currentBuyingPrice = finalPrice;

    const settings = getSettings();
    const bankName = settings.bankName || 'MB';
    const bankAcc = settings.bankAcc || '0362062410';
    const syntax = `Mua ${acc.code}`;

    document.getElementById('modalAccInfo').textContent = acc.info || 'Đang cập nhật...';
    document.getElementById('modalAccDesc').textContent = acc.description || 'Đang cập nhật...';
    document.getElementById('modalAccCode').textContent = acc.code;
    document.getElementById('modalSyntaxCode').textContent = `Nội dung CK: ${syntax}`;

    const originalPriceEl = document.getElementById('modalOriginalPrice');
    const discountNoteEl = document.getElementById('modalDiscountNote');
    if (eligibleDiscount) {
        originalPriceEl.textContent = formatVND(acc.price);
        originalPriceEl.style.display = 'inline';
        discountNoteEl.style.display = 'block';
    } else {
        originalPriceEl.style.display = 'none';
        discountNoteEl.style.display = 'none';
    }
    document.getElementById('modalAccPrice').textContent = formatVND(finalPrice);

    // Ưu tiên dùng ảnh QR admin tự tải lên; nếu không có thì tự sinh qua VietQR
    // theo đúng số tiền (đã áp giảm giá nếu có) và nội dung chuyển khoản.
    const qrImg = document.getElementById('modalQrImg');
    if (settings.qrImageUrl) {
        qrImg.src = resolveMediaSrc(settings.qrImageUrl, '');
    } else {
        qrImg.src = `https://img.vietqr.io/image/${encodeURIComponent(bankName)}-${encodeURIComponent(bankAcc)}-compact2.png?amount=${finalPrice}&addInfo=${encodeURIComponent(syntax)}&accountName=${encodeURIComponent(settings.bankOwner || 'VU HUY DUC')}`;
    }

    document.getElementById('buyModal').classList.add('active');
}

function closeModal() {
    document.getElementById('buyModal').classList.remove('active');
}

async function confirmPaymentZalo() {
    if (currentDiscountApplied) {
        try {
            await markDiscountUsedApi();   // mỗi thiết bị chỉ dùng ưu đãi 5% đúng 1 lần
            _deviceStatus.discountUsed = true;
            checkDeviceDiscountCode();
        } catch (err) {
            console.error('Không thể ghi nhận sử dụng mã giảm giá:', err);
        }
    }

    const discountNote = currentDiscountApplied ? ' (đã áp giảm 5%)' : '';
    alert(`Đã ghi nhận yêu cầu mua mã tài khoản [${currentBuyingCode}]${discountNote}. Hệ thống sẽ chuyển hướng bạn sang Zalo Admin để xác thực giao dịch chuyển khoản. Lưu ý chuyển đúng số tiền: ${formatVND(currentBuyingPrice)}.`);

    const zaloUrl = (getSettings().socialLinks && getSettings().socialLinks.zalo) || 'https://zalo.me/0362062410';
    const separator = zaloUrl.includes('?') ? '&' : '?';
    const text = encodeURIComponent(`Admin oi, toi da thanh toan don hang ${currentBuyingCode} gia ${currentBuyingPrice}d${currentDiscountApplied ? ' (da ap giam 5%)' : ''}`);
    window.open(`${zaloUrl}${separator}text=${text}`, '_blank');
    closeModal();
}
