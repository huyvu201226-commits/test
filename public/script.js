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
    } catch (err) {
        console.error('Không thể tải dữ liệu từ máy chủ:', err);
        if (grid) grid.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1;">Không thể kết nối máy chủ. Vui lòng thử tải lại trang sau ít phút.</p>';
    }
    // Tách riêng khỏi try/catch phía trên: nếu initClientData() lỗi nhưng lấy trạng thái thiết bị
    // vẫn thành công (hoặc ngược lại), KHÔNG được để _deviceStatus rơi về mặc định "chưa quay" —
    // đó chính là nguyên nhân khiến vòng quay tưởng như quay lại được sau khi tải lại trang.
    try {
        _deviceStatus = await getDeviceStatus();
    } catch (err) {
        console.error('Không thể tải trạng thái thiết bị (lượt quay/ưu đãi):', err);
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
    renderEventGames();       // 3 trò chơi tương tác riêng cho từng sự kiện (tab Quay Là Trúng)
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
// NGUYÊN NHÂN GỐC (đã tìm ra): hàm này trước đây là async và có "await clientDataReadyPromise"
// TRƯỚC KHI gọi audio.play(). Trên di động — đặc biệt iOS Safari, và cả nhiều bản Chrome Android
// mới — trình duyệt chỉ cho phép play() chạy nếu nó được gọi ĐỒNG BỘ, ngay trong đúng thao tác
// chạm của người dùng (click handler). Chỉ cần có 1 "await" (dù chỉ đợi 1 microtask) xen giữa là
// trình duyệt coi thao tác chạm đã "nguội" và tự ý chặn play() — không báo lỗi rõ ràng, chỉ bị
// nuốt âm thầm trong .catch(). Đây là nguyên nhân chính khiến điện thoại thường xuyên mất tiếng.
// CÁCH SỬA: gọi audio.play() NGAY LẬP TỨC, đồng bộ, ngay khi hàm được gọi từ onclick — không await
// trước đó. Nếu lúc này audio.src chưa kịp có (mạng chậm, settings chưa tải xong), mới đợi tải
// xong rồi thử lại — lần thử lại này có thể bị vài trình duyệt di động chặn (không còn đúng thao
// tác chạm), nhưng đó là trường hợp hiếm hơn nhiều so với lỗi mất tiếng thường trực trước đây.
function enterWebsite() {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.classList.add('hidden');

    // Bắt buộc khách phải đăng nhập (nếu đã có tài khoản) hoặc đăng ký (nếu chưa có) ngay sau
    // khi bấm "Ấn vào đây để tiếp tục" thì mới được xem tiếp trang Shop — mở NGAY, đồng bộ,
    // không đợi (không await) gì trước audio.play() bên dưới để không phá vỡ thao tác chạm
    // (xem ghi chú autoplay phía trên hàm này).
    if (!isCustomerLoggedIn()) {
        openCustomerAuthGate();
    }

    const audio = document.getElementById('bgAudio');
    if (!audio) return;

    const tryPlay = () => {
        if (!audio.src) return false;
        audio.play().then(() => {
            isPlayingMusic = true;
            const btn = document.getElementById('btnPlayMusic');
            if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i> Đang phát nhạc...';
        }).catch(e => console.log("Trình duyệt chặn autoplay âm thanh:", e));
        return true;
    };

    // Gọi ngay, đồng bộ, trong đúng thao tác chạm — ưu tiên trường hợp phổ biến (src đã có sẵn).
    if (tryPlay()) return;

    // audio.src chưa có (dữ liệu/settings còn đang tải) — đợi tải xong rồi thử lại.
    if (clientDataReadyPromise) {
        clientDataReadyPromise
            .catch(() => { /* lỗi tải dữ liệu đã được báo ở nơi khác */ })
            .then(() => {
                if (!audio.src) {
                    const audioSrc = resolveMediaSrc(getSettings().audioUrl, '');
                    if (audioSrc) audio.src = audioSrc;
                }
                tryPlay();
            });
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
            // Server báo alreadySpun = trình duyệt bị lệch trạng thái (VD do tải trang lỗi) chứ
            // KHÔNG phải một lượt quay mới — không được hiện lại như thể vừa quay lần đầu.
            if (result.alreadySpun) {
                renderPromoWheelStatus();
                return;
            }
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
            // Tương tự vòng quay khuyến mãi — alreadySpun nghĩa là đây chỉ là kết quả CŨ được trả
            // lại do trạng thái trình duyệt bị lệch, không phải một lượt quay mới thật sự.
            if (result.alreadySpun) {
                renderFreeSpinStatus();
                return;
            }
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
// SỰ KIỆN (Giai đoạn 2) — 4 loại sự kiện dùng chung 1 tầng dữ liệu nhưng khác giao diện:
//   - uu_dai   : CHỈ là 1 bảng thông báo giảm giá ở tab Shop, không phải trò chơi.
//   - vong_quay: vòng quay may mắn.
//   - dap_tho  : đập thỏ nhấp nhô trong các ô/giếng.
//   - dap_hop  : đập hộp quà trong lưới.
// Cả 3 loại tương tác đều dùng chung: giới hạn tổng lượt chơi (maxPlays/playsUsed) và khóa QR
// (requireQr) — khách phải thanh toán rồi gửi yêu cầu, chờ Admin duyệt mới được chơi.
// ============================================================
// Markup dùng chung cho 1 banner "Giảm Deal" — tái sử dụng ở cả tab Shop và tab Ưu Đãi.
function dealBannerHtml(ev) {
    return `
    <div class="hover-card" style="padding:16px; display:flex; align-items:center; gap:14px; margin-bottom:14px; border-color:var(--gold);">
        ${ev.banner ? `<img src="${escapeHtml(resolveMediaSrc(ev.banner, DEFAULT_LOGO))}" alt="${escapeHtml(ev.name)}" loading="lazy" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;">` : `<i class="fa-solid fa-fire icon-flame-anim" style="font-size:2rem;color:var(--gold);flex-shrink:0;"></i>`}
        <div>
            <div style="font-weight:800;">${escapeHtml(ev.name)} <span class="promo-5-badge" style="margin:0 0 0 6px; padding:2px 10px; font-size:0.7rem; cursor:default;">Giảm ${Number(ev.discountPercent) || 0}%</span></div>
            <div style="font-size:0.85rem; color: var(--text-muted); margin-top:4px;">${escapeHtml(ev.description || 'Giá sẽ tự động được gạch giảm khi đặt mua trong thời gian sự kiện.')}</div>
        </div>
    </div>`;
}

// Bảng thông báo Giảm Deal ở tab "Ưu Đãi" — cùng nội dung với banner ở tab Shop, để khách
// vào đúng tab "Ưu Đãi" (tên gợi ý sẵn ưu đãi) cũng thấy ngay, không phải mò sang tab Shop mới biết.
function renderPromoDealBanner() {
    const container = document.getElementById('promoDealBanner');
    if (!container) return;
    const deals = getEvents().filter(ev => ev.type === 'uu_dai' && ev.displayState === 'active');
    container.innerHTML = deals.map(dealBannerHtml).join('');
}

function renderShopEventBanners() {
    const container = document.getElementById('shopEventsBanner');
    if (!container) return;
    const events = getEvents();
    if (events.length === 0) { container.innerHTML = ''; renderPromoDealBanner(); return; }

    container.innerHTML = events.map(ev => {
        if (ev.displayState !== 'active' && ev.displayState !== 'locked') return '';

        // Sự kiện Giảm Deal: chỉ hiện bảng thông báo, KHÔNG dẫn sang trò chơi.
        if (ev.type === 'uu_dai') {
            if (ev.displayState !== 'active') return ''; // Giảm Deal không có trạng thái "tạm khóa hiện mờ"
            return dealBannerHtml(ev);
        }

        // 3 sự kiện tương tác: banner dẫn sang tab "Quay Là Trúng" để chơi.
        return `
        <div class="hover-card" style="padding:16px; display:flex; align-items:center; gap:14px; cursor:pointer; margin-bottom:14px;"
             onclick="switchTab('randomTab', document.querySelectorAll('.nav-link')[1]); window.scrollTo({top:0,behavior:'smooth'});">
            ${ev.banner ? `<img src="${escapeHtml(resolveMediaSrc(ev.banner, DEFAULT_LOGO))}" alt="${escapeHtml(ev.name)}" loading="lazy" style="width:64px;height:64px;border-radius:10px;object-fit:cover;flex-shrink:0;">` : `<i class="fa-solid fa-gift icon-flame-anim" style="font-size:2rem;color:var(--gold);flex-shrink:0;"></i>`}
            <div>
                <div style="font-weight:800;">${escapeHtml(ev.name)} <span class="promo-5-badge" style="margin:0 0 0 6px; padding:2px 10px; font-size:0.7rem;">${escapeHtml(EVENT_TYPE_LABELS[ev.type] || 'Sự kiện')}</span></div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">${escapeHtml(ev.description || 'Bấm để tham gia sự kiện!')}</div>
            </div>
        </div>`;
    }).join('');
    renderPromoDealBanner();
}

// eventId -> true trong lúc đang chờ máy chủ trả kết quả (chặn bấm đúp / đập đúp)
let _eventGameBusy = {};
// eventId -> { interval, activeIndex } — timer thỏ nhấp nhô đang chạy, phải dọn dẹp mỗi lần render lại
let _activeRabbitTimers = {};
let _currentEventQrId = null;

function renderEventGames() {
    const container = document.getElementById('eventWheelsContainer');
    if (!container) return;

    // Dọn hết timer thỏ cũ trước khi thay DOM, tránh rò rỉ interval trỏ tới phần tử đã mất.
    Object.values(_activeRabbitTimers).forEach(t => t && t.interval && clearInterval(t.interval));
    _activeRabbitTimers = {};

    const events = getEvents().filter(ev => ev.type !== 'uu_dai');
    if (events.length === 0) { container.innerHTML = ''; return; }

    container.innerHTML = events.map(renderEventCardShell).join('');

    events.forEach(ev => {
        if (ev.displayState !== 'active') return;
        const evStatus = _deviceStatus.events && _deviceStatus.events[ev.id];
        const needsAccess = ev.requireQr && (!evStatus || evStatus.requestStatus !== 'approved');
        if (needsAccess) return;
        const maxPlays = (evStatus && evStatus.maxPlays) || Number(ev.maxPlays) || 1;
        const playsUsed = (evStatus && evStatus.playsUsed) || 0;
        if (playsUsed >= maxPlays) return;
        if (ev.type === 'dap_tho') startRabbitGame(ev);
    });
}

function renderEventCardShell(ev) {
    const evStatus = (_deviceStatus.events && _deviceStatus.events[ev.id]) || { playsUsed: 0, maxPlays: Number(ev.maxPlays) || 1, requestStatus: 'none' };
    const header = `
        <h3>${escapeHtml(ev.name)} <span class="promo-5-badge" style="margin-left:6px;padding:2px 10px;font-size:0.7rem;cursor:default;">${escapeHtml(EVENT_TYPE_LABELS[ev.type] || '')}</span></h3>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin: 8px 0 15px;">${escapeHtml(ev.description || '')}</p>`;

    // Sự kiện tạm đóng / chưa tới ngày diễn ra: hiện mờ + thông báo hướng dẫn, không cho chơi.
    if (ev.displayState === 'locked') {
        return `
        <div class="hover-card promo-box event-locked-card" style="margin-top:20px;">
            <i class="fa-solid fa-lock" style="font-size:2rem;color:var(--text-muted);margin-bottom:10px;"></i>
            ${header}
            <p style="font-size:0.85rem; color:#f97316; background:rgba(249,115,22,0.1); border:1px solid #f97316; border-radius:8px; padding:10px;">
                <i class="fa-solid fa-circle-info"></i> ${escapeHtml(ev.closedNoticeText || 'Sự kiện hiện đang tạm đóng, vui lòng quay lại sau.')}
            </p>
        </div>`;
    }

    // Khóa bằng QR: khách chưa được duyệt truy cập -> hiện luồng thanh toán + gửi yêu cầu.
    if (ev.requireQr && evStatus.requestStatus !== 'approved') {
        let body;
        if (evStatus.requestStatus === 'pending') {
            body = `<p style="font-size:0.85rem;color:var(--gold);background:rgba(255,193,7,0.08);border:1px solid var(--gold);border-radius:8px;padding:10px;"><i class="fa-solid fa-hourglass-half"></i> Yêu cầu tham gia của bạn đang chờ Admin duyệt. Vui lòng quay lại sau ít phút.</p>`;
        } else if (evStatus.requestStatus === 'rejected') {
            body = `<p style="font-size:0.85rem;color:#ef4444;background:rgba(239,68,68,0.08);border:1px solid #ef4444;border-radius:8px;padding:10px;margin-bottom:10px;"><i class="fa-solid fa-circle-xmark"></i> Yêu cầu trước đó đã bị từ chối. Vui lòng kiểm tra lại giao dịch rồi gửi lại yêu cầu.</p>
                <button class="btn-submit" onclick="openEventQrModal('${ev.id}')">Gửi Lại Yêu Cầu Tham Gia</button>`;
        } else {
            body = `<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px;">Sự kiện này yêu cầu thanh toán trước khi tham gia.</p>
                <button class="btn-submit pulse-anim" onclick="openEventQrModal('${ev.id}')">Thanh Toán &amp; Yêu Cầu Tham Gia</button>`;
        }
        return `<div class="hover-card promo-box" style="margin-top:20px;">${header}${body}</div>`;
    }

    const maxPlays = evStatus.maxPlays || Number(ev.maxPlays) || 1;
    const playsUsed = evStatus.playsUsed || 0;
    const playsLeft = Math.max(0, maxPlays - playsUsed);
    const statusLine = `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:10px;">Còn ${playsLeft}/${maxPlays} lượt chơi.</p>`;

    if (playsLeft <= 0) {
        return `<div class="hover-card promo-box" style="margin-top:20px;">${header}
            <p style="font-size:0.85rem;color:var(--text-muted);">Bạn đã dùng hết lượt chơi của sự kiện này. Cảm ơn bạn đã tham gia!</p>
        </div>`;
    }

    if (ev.type === 'vong_quay') {
        const sliceClasses = ['slice-1', 'slice-2', 'slice-3', 'slice-4', 'slice-5', 'slice-6'];
        const wheelSlices = ev.rewards.slice(0, 6).map((r, i) => `<div class="wheel-slice ${sliceClasses[i % 6]}"><span>${escapeHtml((r.name || '').slice(0, 10))}</span></div>`).join('');
        return `<div class="hover-card promo-box" style="margin-top:20px;">
            ${header}
            <div class="wheel-container">
                <div class="wheel-pointer"></div>
                <div class="wheel-circle" id="eventWheel_${ev.id}">${wheelSlices}</div>
            </div>
            <p id="eventStatus_${ev.id}" style="font-size:0.85rem;color:var(--text-muted);margin-top:12px;">Bấm để quay thử vận may!</p>
            <button class="btn-submit pulse-anim" style="margin-top:15px;" onclick="playEventWheel('${ev.id}')" id="eventPlayBtn_${ev.id}">Quay Sự Kiện</button>
            ${statusLine}
        </div>`;
    }

    if (ev.type === 'dap_tho') {
        const holes = Number(ev.rabbitHoles) || 6;
        const holeCells = Array.from({ length: holes }, (_, i) => `
            <div class="rabbit-hole" data-hole="${i}" onclick="handleRabbitHoleClick('${ev.id}', ${i})">
                <div class="rabbit-hole-dirt"></div>
                <div class="rabbit-emoji" id="rabbit_${ev.id}_${i}">🐰</div>
            </div>`).join('');
        return `<div class="hover-card promo-box" style="margin-top:20px;">
            ${header}
            <div class="rabbit-grid" id="rabbitGrid_${ev.id}">${holeCells}</div>
            <p id="eventStatus_${ev.id}" style="font-size:0.85rem;color:var(--text-muted);margin-top:12px;">Nhanh tay đập trúng chú thỏ đang nhấp nhô!</p>
            ${statusLine}
        </div>`;
    }

    if (ev.type === 'dap_hop') {
        const boxes = Number(ev.boxCount) || 6;
        const boxCells = Array.from({ length: boxes }, (_, i) => `
            <div class="lucky-box" id="box_${ev.id}_${i}" data-box="${i}" onclick="handleBoxClick('${ev.id}', ${i})"><i class="fa-solid fa-gift"></i></div>`).join('');
        return `<div class="hover-card promo-box" style="margin-top:20px;">
            ${header}
            <div class="lucky-box-grid" id="boxGrid_${ev.id}">${boxCells}</div>
            <p id="eventStatus_${ev.id}" style="font-size:0.85rem;color:var(--text-muted);margin-top:12px;">Chọn 1 hộp quà may mắn bất kỳ!</p>
            ${statusLine}
        </div>`;
    }

    return '';
}

// Ghi kết quả 1 lượt chơi (dùng chung cho cả 3 loại game) vào cache trạng thái thiết bị,
// báo cho khách biết trúng/trượt, rồi vẽ lại toàn bộ khối sự kiện (tự sinh lượt chơi mới nếu còn).
function applyEventPlayResult(eventId, result, statusEl) {
    if (!_deviceStatus.events) _deviceStatus.events = {};
    const prevStatus = _deviceStatus.events[eventId] || {};
    _deviceStatus.events[eventId] = {
        playsUsed: result.playsUsed != null ? result.playsUsed : prevStatus.playsUsed,
        maxPlays: result.maxPlays != null ? result.maxPlays : prevStatus.maxPlays,
        requestStatus: prevStatus.requestStatus || 'none'
    };

    if (result.limitReached) {
        if (statusEl) statusEl.textContent = 'Bạn đã dùng hết lượt chơi của sự kiện này.';
    } else if (result.won && result.prize) {
        openEventPrizeModal(result.prize);
    } else {
        alert('Chúc bạn may mắn lần sau!');
    }
    renderEventGames();
}

// Hộp thoại hiện phần thưởng vừa trúng — nếu là quà acc free (có account/password) thì hiện
// luôn tài khoản/mật khẩu kèm nút sao chép, còn không thì chỉ hiện tên + ảnh/mô tả và nhắc
// khách liên hệ Zalo Admin để nhận thưởng.
function openEventPrizeModal(prize) {
    const modal = document.getElementById('eventPrizeModal');
    if (!modal) {
        // Phòng khi index.html chưa có modal (tương thích ngược) — vẫn báo bằng alert như cũ.
        alert(`🎉 Chúc mừng! Bạn đã trúng "${prize.name}" từ sự kiện! Liên hệ Zalo Admin để nhận thưởng.`);
        return;
    }

    document.getElementById('eventPrizeName').textContent = prize.name || 'Phần thưởng';

    const imgEl = document.getElementById('eventPrizeImg');
    const descEl = document.getElementById('eventPrizeDesc');
    if (prize.image) {
        imgEl.src = resolveMediaSrc(prize.image, '');
        imgEl.style.display = '';
    } else {
        imgEl.style.display = 'none';
    }
    descEl.textContent = prize.imageDesc || '';
    descEl.style.display = prize.imageDesc ? '' : 'none';

    const accBox = document.getElementById('eventPrizeAccBox');
    if (prize.account) {
        accBox.style.display = '';
        document.getElementById('eventPrizeAccount').textContent = prize.account;
        document.getElementById('eventPrizePassword').textContent = prize.password || '';
    } else {
        accBox.style.display = 'none';
    }

    document.getElementById('eventPrizeContactNote').style.display = prize.account ? 'none' : '';

    modal.classList.add('active');
}

function closeEventPrizeModal() {
    document.getElementById('eventPrizeModal').classList.remove('active');
}

function copyEventPrizeCreds() {
    const acc = document.getElementById('eventPrizeAccount').textContent;
    const pass = document.getElementById('eventPrizePassword').textContent;
    navigator.clipboard.writeText(`Tài khoản: ${acc}\nMật khẩu: ${pass}`);
    alert('Đã sao chép tài khoản/mật khẩu!');
}

function copyBuyDeliveredCreds() {
    const acc = document.getElementById('buyDeliveredAccount').textContent;
    const pass = document.getElementById('buyDeliveredPassword').textContent;
    navigator.clipboard.writeText(`Tài khoản: ${acc}\nMật khẩu: ${pass}`);
    alert('Đã sao chép tài khoản/mật khẩu!');
}

// --- Vòng Quay May Mắn ---
async function playEventWheel(eventId) {
    if (_eventGameBusy[eventId]) return;
    _eventGameBusy[eventId] = true;
    const btn = document.getElementById(`eventPlayBtn_${eventId}`);
    const wheel = document.getElementById(`eventWheel_${eventId}`);
    const status = document.getElementById(`eventStatus_${eventId}`);
    if (btn) btn.disabled = true;

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    if (wheel) wheel.style.transform = `rotate(${randomDeg}deg)`;

    try {
        const result = await spinEventWheelApi(eventId);
        setTimeout(() => {
            _eventGameBusy[eventId] = false;
            applyEventPlayResult(eventId, result, status);
        }, 4000);
    } catch (err) {
        _eventGameBusy[eventId] = false;
        if (btn) btn.disabled = false;
        alert('Không thể kết nối máy chủ: ' + err.message);
    }
}

// --- Đập Thỏ May Mắn: thỏ tự nhảy giữa các ô mỗi rabbitSpeedMs, khách phải đập đúng ô đang có thỏ ---
function startRabbitGame(ev) {
    const holes = Number(ev.rabbitHoles) || 6;
    const speed = Number(ev.rabbitSpeedMs) || 800;
    let activeIndex = -1;

    function moveRabbit() {
        const grid = document.getElementById(`rabbitGrid_${ev.id}`);
        if (!grid) { clearInterval(timer); return; } // thẻ đã bị vẽ lại/gỡ khỏi DOM
        if (activeIndex >= 0) {
            const prevEl = document.getElementById(`rabbit_${ev.id}_${activeIndex}`);
            if (prevEl) prevEl.classList.remove('rabbit-up');
        }
        let next = Math.floor(Math.random() * holes);
        if (holes > 1) { while (next === activeIndex) next = Math.floor(Math.random() * holes); }
        activeIndex = next;
        const el = document.getElementById(`rabbit_${ev.id}_${activeIndex}`);
        if (el) el.classList.add('rabbit-up');
    }

    const timer = setInterval(moveRabbit, speed);
    moveRabbit();
    _activeRabbitTimers[ev.id] = { interval: timer, get activeIndex() { return activeIndex; } };
}

async function handleRabbitHoleClick(eventId, holeIndex) {
    if (_eventGameBusy[eventId]) return;
    const t = _activeRabbitTimers[eventId];
    if (!t || t.activeIndex !== holeIndex) {
        // Đập hụt: rung nhẹ để phản hồi, thỏ vẫn tiếp tục nhảy bình thường, không tốn lượt chơi.
        const el = document.getElementById(`rabbit_${eventId}_${holeIndex}`);
        if (el) { el.classList.add('rabbit-miss'); setTimeout(() => el.classList.remove('rabbit-miss'), 300); }
        return;
    }

    _eventGameBusy[eventId] = true;
    clearInterval(t.interval);
    delete _activeRabbitTimers[eventId];
    const status = document.getElementById(`eventStatus_${eventId}`);
    if (status) status.textContent = 'Đang xử lý...';

    try {
        const result = await spinEventWheelApi(eventId);
        _eventGameBusy[eventId] = false;
        applyEventPlayResult(eventId, result, status);
    } catch (err) {
        _eventGameBusy[eventId] = false;
        alert('Không thể kết nối máy chủ: ' + err.message);
    }
}

// --- Đập Hộp May Mắn: khách chọn 1 hộp bất kỳ trong lưới ---
async function handleBoxClick(eventId, boxIndex) {
    if (_eventGameBusy[eventId]) return;
    const boxEl = document.getElementById(`box_${eventId}_${boxIndex}`);
    if (boxEl && boxEl.classList.contains('box-opened')) return;
    _eventGameBusy[eventId] = true;
    if (boxEl) boxEl.classList.add('box-shaking');

    try {
        const result = await spinEventWheelApi(eventId);
        setTimeout(() => {
            if (boxEl) {
                boxEl.classList.remove('box-shaking');
                boxEl.classList.add('box-opened');
                boxEl.innerHTML = (result.won && result.prize)
                    ? '<i class="fa-solid fa-trophy" style="color:var(--gold);"></i>'
                    : '<i class="fa-solid fa-face-sad-tear"></i>';
            }
            _eventGameBusy[eventId] = false;
            const status = document.getElementById(`eventStatus_${eventId}`);
            applyEventPlayResult(eventId, result, status);
        }, 600);
    } catch (err) {
        _eventGameBusy[eventId] = false;
        if (boxEl) boxEl.classList.remove('box-shaking');
        alert('Không thể kết nối máy chủ: ' + err.message);
    }
}

// --- Khóa QR: mở modal thanh toán + gửi yêu cầu tham gia (dùng chung QR admin đã cấu hình) ---
function buildQrImageUrl(amount, note) {
    const settings = getSettings();
    if (settings.qrImageUrl) return resolveMediaSrc(settings.qrImageUrl, '');
    const bankName = settings.bankName || 'MB';
    const bankAcc = settings.bankAcc || '0362062410';
    return `https://img.vietqr.io/image/${encodeURIComponent(bankName)}-${encodeURIComponent(bankAcc)}-compact2.png?amount=${Number(amount) || 0}&addInfo=${encodeURIComponent(note)}&accountName=${encodeURIComponent(settings.bankOwner || 'VU HUY DUC')}`;
}

function openEventQrModal(eventId) {
    if (!requireCustomerLoginOrPrompt({ type: 'event', eventId })) return;
    const ev = getEvents().find(e => e.id === eventId);
    if (!ev) return;
    _currentEventQrId = eventId;
    const note = ev.qrNote || `Tham gia ${ev.name}`;

    document.getElementById('eventQrTitle').innerHTML = `<i class="fa-solid fa-qrcode"></i> Tham Gia "${escapeHtml(ev.name)}"`;
    document.getElementById('eventQrImg').src = buildQrImageUrl(ev.qrAmount, note);
    document.getElementById('eventQrAmountText').textContent = `Số tiền: ${formatVND(ev.qrAmount || 0)}`;
    document.getElementById('eventQrNoteText').textContent = ev.qrNote ? `Ghi chú: ${ev.qrNote}` : '';
    document.getElementById('eventQrMsg').textContent = '';
    document.getElementById('eventQrPayerName').value = '';
    document.getElementById('eventQrPayerBankAccount').value = '';
    document.getElementById('eventQrWaitBox').style.display = 'none';
    clearInterval(_eventQrCountdownTimer);
    clearInterval(_eventQrPollTimer);

    const btn = document.getElementById('eventQrSubmitBtn');
    btn.disabled = false;
    btn.style.display = 'inline-block';
    btn.textContent = 'Đã Chuyển Khoản - Gửi Yêu Cầu Tham Gia';

    document.getElementById('eventQrModal').classList.add('active');
}

function closeEventQrModal() {
    document.getElementById('eventQrModal').classList.remove('active');
    _currentEventQrId = null;
    clearInterval(_eventQrCountdownTimer);
    clearInterval(_eventQrPollTimer);
}

// Đếm ngược dùng CHUNG cho cả "chờ duyệt tham gia sự kiện" (startEventQrWait) và "chờ duyệt mua
// acc" (startBuyWait) — 2 nơi này trước đây tự viết lặp lại y hệt đoạn đếm giờ + hiện nút Zalo
// khi hết giờ, giờ gộp về 1 hàm dùng chung để dễ sửa/bảo trì (chỉ khác nhau ở phần polling trạng
// thái, giữ riêng ở từng nơi gọi). Trả về id của setInterval để nơi gọi tự clearInterval khi đóng
// modal hoặc bắt đầu lượt chờ mới.
function startPaymentCountdown(deadlineMs, countdownEl, zaloBtn) {
    zaloBtn.style.display = 'none';
    zaloBtn.href = (getSettings().socialLinks && getSettings().socialLinks.zalo) || 'https://zalo.me/0362062410';
    let timerId;
    timerId = setInterval(() => {
        const msLeft = deadlineMs - Date.now();
        if (msLeft <= 0) {
            countdownEl.textContent = '00:00';
            zaloBtn.style.display = 'inline-block';
            clearInterval(timerId);
            return;
        }
        const totalSec = Math.floor(msLeft / 1000);
        countdownEl.textContent = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
    }, 1000);
    return timerId;
}

// Đếm ngược 5 phút chờ Admin duyệt; hết giờ mà vẫn "pending" thì hiện nút chat Zalo hỗ trợ.
// Đồng thời tự hỏi lại máy chủ mỗi 10s để đóng sớm nếu Admin đã duyệt/từ chối trước đó.
let _eventQrCountdownTimer = null;
let _eventQrPollTimer = null;
function startEventQrWait(deadlineMs, eventId) {
    const waitBox = document.getElementById('eventQrWaitBox');
    const countdownEl = document.getElementById('eventQrCountdown');
    const zaloBtn = document.getElementById('eventQrZaloBtn');
    const submitBtn = document.getElementById('eventQrSubmitBtn');
    waitBox.style.display = 'block';
    submitBtn.style.display = 'none';

    clearInterval(_eventQrCountdownTimer);
    clearInterval(_eventQrPollTimer);
    _eventQrCountdownTimer = startPaymentCountdown(deadlineMs, countdownEl, zaloBtn);

    _eventQrPollTimer = setInterval(async () => {
        try {
            _deviceStatus = await getDeviceStatus();
            const evState = (_deviceStatus.events && _deviceStatus.events[eventId]) || {};
            if (evState.requestStatus === 'approved') {
                clearInterval(_eventQrCountdownTimer);
                clearInterval(_eventQrPollTimer);
                document.getElementById('eventQrMsg').textContent = 'Đã được Admin duyệt! Bạn có thể tham gia sự kiện ngay bây giờ.';
                waitBox.style.display = 'none';
                renderEventGames();
                setTimeout(closeEventQrModal, 1800);
            } else if (evState.requestStatus === 'rejected') {
                clearInterval(_eventQrCountdownTimer);
                clearInterval(_eventQrPollTimer);
                document.getElementById('eventQrMsg').textContent = 'Yêu cầu đã bị Admin từ chối. Vui lòng liên hệ Zalo Admin để biết thêm chi tiết.';
                waitBox.style.display = 'none';
                submitBtn.style.display = 'inline-block';
                submitBtn.textContent = 'Gửi Lại Yêu Cầu Tham Gia';
                submitBtn.disabled = false;
                renderEventGames();
            }
        } catch (err) { /* im lặng, thử lại ở lần poll sau */ }
    }, 10000);
}

async function submitEventAccessRequest() {
    if (!_currentEventQrId) return;
    const eventId = _currentEventQrId;
    const btn = document.getElementById('eventQrSubmitBtn');
    btn.disabled = true;

    const payerName = document.getElementById('eventQrPayerName').value.trim();
    const payerBankAccount = document.getElementById('eventQrPayerBankAccount').value.trim();

    try {
        const result = await requestEventAccessApi(eventId, '', payerName, payerBankAccount);
        if (!_deviceStatus.events) _deviceStatus.events = {};
        const prev = _deviceStatus.events[eventId] || {};
        _deviceStatus.events[eventId] = { ...prev, requestStatus: result.requestStatus };
        document.getElementById('eventQrMsg').textContent = 'Đã gửi yêu cầu! Vui lòng chờ Admin duyệt (thường trong ít phút).';
        renderEventGames();
        if (result.requestStatus === 'pending' && result.deadlineMs) {
            startEventQrWait(result.deadlineMs, eventId);
        } else if (result.requestStatus === 'approved') {
            setTimeout(closeEventQrModal, 1200);
        }
    } catch (err) {
        btn.disabled = false;
        document.getElementById('eventQrMsg').textContent = 'Lỗi: ' + err.message;
    }
}

// Tính ưu đãi tốt nhất hiện có cho 1 acc — dùng chung cho cả lưới Shop (badge góc trái ảnh +
// giá gạch ngang) và modal thanh toán, để 2 nơi luôn hiển thị đúng và khớp nhau.
// Ưu tiên: mã giảm 5%/thiết bị (không áp cho Acc Reg, dùng 1 lần) HOẶC % của sự kiện "Giảm Deal"
// đang hoạt động (áp cho mọi loại acc) — lấy % nào cao hơn.
function getAccountDiscountInfo(acc) {
    const deviceEligible = isEligibleForDiscount(acc, _deviceStatus.discountUsed);
    const devicePercent = deviceEligible ? 5 : 0;
    const dealEvent = getBestActiveDealEvent();
    const dealPercent = dealEvent ? Number(dealEvent.discountPercent) || 0 : 0;

    if (dealPercent >= devicePercent && dealPercent > 0) {
        return { source: 'deal', percent: dealPercent, dealEvent };
    }
    if (devicePercent > 0) {
        return { source: 'device', percent: devicePercent, dealEvent: null };
    }
    return { source: null, percent: 0, dealEvent: null };
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
        const discountInfo = getAccountDiscountInfo(acc);
        const hasDiscount = discountInfo.percent > 0;
        const finalPrice = hasDiscount ? Math.round(acc.price * (1 - discountInfo.percent / 100)) : acc.price;

        const priceHtml = hasDiscount
            ? `<div class="acc-price">
                   <span class="acc-price-old">${formatVND(acc.price)}</span>
                   <span class="acc-price-new">${formatVND(finalPrice)}</span>
               </div>`
            : `<div class="acc-price">${formatVND(acc.price)}</div>`;

        const card = document.createElement('div');
        card.className = 'acc-card hover-card';
        card.innerHTML = `
            <div class="acc-img-wrap">
                <img src="${escapeHtml(resolveMediaSrc(acc.img, fallbackImg))}" alt="Ảnh acc ${escapeHtml(acc.code)}" loading="lazy">
                ${statusInfo.badge}
                ${hasDiscount ? `<span class="acc-discount-badge">-${discountInfo.percent}%</span>` : ''}
            </div>
            <div class="acc-body">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="acc-code">${escapeHtml(acc.code)}</span>
                    <span class="type-pill ${typeInfo.badge}">${typeInfo.text}</span>
                </div>
                <h4 class="acc-title">${escapeHtml(acc.name)}</h4>
                ${acc.info ? `<div style="font-size:0.8rem; color: var(--text-muted);">${escapeHtml(acc.info)}</div>` : ''}
                ${priceHtml}
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
        const img = e.target.closest('.acc-img-wrap img');
        if (img) { openImgLightbox(img.src, img.alt); return; }

        const btn = e.target.closest('.btn-action-acc');
        if (!btn || btn.disabled) return;
        openBuyModal(btn.dataset.code);
    });
}

// ------------------------------------------------------------
// Lightbox xem ảnh acc phóng to: bấm vào ảnh trong lưới Shop để xem chi tiết, bấm vào
// ảnh trong lightbox để phóng to/thu nhỏ (bấm lần nữa để thu về vừa khung), bấm ra
// ngoài ảnh hoặc nút "x" để đóng. Trên di động vẫn dùng pinch-to-zoom 2 ngón tay được
// như bình thường vì viewport không khoá user-scalable.
// ------------------------------------------------------------
function openImgLightbox(src, alt) {
    const overlay = document.getElementById('imgLightbox');
    const img = document.getElementById('lightboxImg');
    if (!overlay || !img || !src) return;
    img.src = src;
    img.alt = alt || 'Ảnh acc phóng to';
    img.classList.remove('zoomed');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // khoá cuộn trang nền trong lúc xem ảnh
}

function closeImgLightbox() {
    const overlay = document.getElementById('imgLightbox');
    const img = document.getElementById('lightboxImg');
    if (overlay) overlay.classList.remove('active');
    if (img) { img.classList.remove('zoomed'); img.src = ''; }
    document.body.style.overflow = '';
}

// Chỉ đóng khi bấm đúng vào lớp nền (backdrop), không đóng khi bấm vào ảnh hay nút đóng
function closeImgLightboxIfBackdrop(event) {
    if (event.target.id === 'imgLightbox') closeImgLightbox();
}

function toggleLightboxZoom(event) {
    event.stopPropagation();
    const img = document.getElementById('lightboxImg');
    if (img) img.classList.toggle('zoomed');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeImgLightbox();
});

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
let currentBuyingAccountId = null;
let currentBuyingPrice = 0;
let currentDiscountApplied = false;
let currentDiscountSource = null; // 'device' (mã giảm 5%/thiết bị) | 'deal' (sự kiện Giảm Deal) | null
let currentDiscountPercent = 0;

// Nhận vào mã acc, tự tra cứu đầy đủ dữ liệu (thông tin, mô tả, loại, giá) để hiển thị
// tách biệt "thông tin acc" và "mô tả acc" thay vì gộp chung, đồng thời tự áp ưu đãi tốt nhất
// đang có: mã giảm 5%/thiết bị (không áp cho Acc Reg, dùng 1 lần) HOẶC % của sự kiện "Giảm Deal"
// đang hoạt động (áp cho mọi loại acc) — lấy % nào cao hơn. Nếu sự kiện Giảm Deal đã đủ tốt,
// KHÔNG tiêu mã 5% của thiết bị để dành cho lần mua sau không có sự kiện.
function openBuyModal(code) {
    if (!requireCustomerLoginOrPrompt({ type: 'buy', code })) return;
    const acc = getAccounts().find(a => a.code === code);
    if (!acc) return;

    currentBuyingCode = acc.code;
    currentBuyingAccountId = acc.id;

    const discountInfo = getAccountDiscountInfo(acc);
    const dealEvent = discountInfo.dealEvent;
    currentDiscountSource = discountInfo.source;
    currentDiscountPercent = discountInfo.percent;
    currentDiscountApplied = currentDiscountSource !== null;
    const finalPrice = currentDiscountApplied ? Math.round(acc.price * (1 - currentDiscountPercent / 100)) : acc.price;
    currentBuyingPrice = finalPrice;

    const settings = getSettings();
    const bankName = settings.bankName || 'MB';
    const bankAcc = settings.bankAcc || '0362062410';
    const syntax = `Mua ${acc.code}`;

    document.getElementById('modalAccInfo').textContent = acc.info || 'Đang cập nhật...';
    document.getElementById('modalAccDesc').textContent = acc.description || 'Đang cập nhật...';
    document.getElementById('modalAccCode').textContent = acc.code;
    document.getElementById('modalSyntaxCode').textContent = `Nội dung CK: ${syntax}`;
    document.getElementById('buyPayerName').value = '';
    document.getElementById('buyPayerBankAccount').value = '';
    document.getElementById('buyPhoneNumber').value = '';
    document.getElementById('buyPhoneBox').style.display = (acc.type === 'doiso') ? 'block' : 'none';
    document.getElementById('buyModalMsg').textContent = '';
    document.getElementById('buyWaitBox').style.display = 'none';
    document.getElementById('buyDeliveredBox').style.display = 'none';
    const submitBtn = document.getElementById('buySubmitBtn');
    submitBtn.style.display = 'inline-block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đã Thanh Toán - Gửi Yêu Cầu Cho Admin';
    clearInterval(_buyCountdownTimer);
    clearInterval(_buyPollTimer);

    const originalPriceEl = document.getElementById('modalOriginalPrice');
    const discountNoteEl = document.getElementById('modalDiscountNote');
    if (currentDiscountApplied) {
        originalPriceEl.textContent = formatVND(acc.price);
        originalPriceEl.style.display = 'inline';
        discountNoteEl.innerHTML = currentDiscountSource === 'deal'
            ? `<i class="fa-solid fa-tags"></i> Đã áp dụng ưu đãi "${escapeHtml(dealEvent.name)}" - giảm ${currentDiscountPercent}%.`
            : `<i class="fa-solid fa-tags"></i> Đã áp dụng mã giảm giá ${currentDiscountPercent}% (chỉ dùng được 1 lần / thiết bị).`;
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
    clearInterval(_buyCountdownTimer);
    clearInterval(_buyPollTimer);
}

// Đếm ngược 5 phút chờ Admin duyệt; hết giờ mà vẫn "pending" thì hiện nút chat Zalo hỗ trợ.
// Tự hỏi lại máy chủ mỗi 10s để đóng sớm nếu Admin đã duyệt/từ chối.
let _buyCountdownTimer = null;
let _buyPollTimer = null;
function startBuyWait(deadlineMs, requestId) {
    const waitBox = document.getElementById('buyWaitBox');
    const countdownEl = document.getElementById('buyCountdown');
    const zaloBtn = document.getElementById('buyZaloBtn');
    const submitBtn = document.getElementById('buySubmitBtn');
    waitBox.style.display = 'block';
    submitBtn.style.display = 'none';

    clearInterval(_buyCountdownTimer);
    clearInterval(_buyPollTimer);
    _buyCountdownTimer = startPaymentCountdown(deadlineMs, countdownEl, zaloBtn);

    _buyPollTimer = setInterval(async () => {
        try {
            const mine = await getMyPurchaseRequestsApi();
            const reqEntry = mine.find(r => r.id === requestId);
            if (reqEntry && reqEntry.status !== 'pending') {
                clearInterval(_buyCountdownTimer);
                clearInterval(_buyPollTimer);
                waitBox.style.display = 'none';
                if (reqEntry.status === 'approved') {
                    document.getElementById('buyModalMsg').textContent = 'Yêu cầu đã được Admin duyệt! Thông tin acc của bạn ở ngay bên dưới.';
                    document.getElementById('buyDeliveredAccount').textContent = reqEntry.deliveredAccount || '—';
                    document.getElementById('buyDeliveredPassword').textContent = reqEntry.deliveredPassword || '—';
                    document.getElementById('buyDeliveredBox').style.display = 'block';
                    renderAccounts(getAccounts());
                } else {
                    document.getElementById('buyModalMsg').textContent = `Yêu cầu đã bị từ chối.${reqEntry.rejectReason ? ' Lý do: ' + reqEntry.rejectReason : ''}`;
                    submitBtn.style.display = 'inline-block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Gửi Lại Yêu Cầu';
                }
            }
        } catch (err) { /* im lặng, thử lại ở lần poll sau */ }
    }, 10000);
}

async function confirmPaymentZalo() {
    const submitBtn = document.getElementById('buySubmitBtn');
    document.getElementById('buyModalMsg').textContent = '';

    const payerName = document.getElementById('buyPayerName').value.trim();
    const payerBankAccount = document.getElementById('buyPayerBankAccount').value.trim();
    const phoneNumber = document.getElementById('buyPhoneNumber').value.trim();

    const acc = getAccounts().find(a => a.id === currentBuyingAccountId);
    if (acc && acc.type === 'doiso' && !phoneNumber) {
        document.getElementById('buyModalMsg').textContent = 'Vui lòng nhập số điện thoại cần đổi vào acc trước khi gửi yêu cầu.';
        return;
    }

    submitBtn.disabled = true;

    try {
        const result = await submitPurchaseRequestApi(currentBuyingAccountId, payerName, payerBankAccount, phoneNumber);

        // Chỉ tiêu mã giảm 5%/thiết bị khi đó thực sự là nguồn giảm giá được áp dụng — nếu ưu đãi
        // đến từ sự kiện "Giảm Deal" thì để dành mã 5% cho lần mua sau (không có sự kiện).
        if (currentDiscountSource === 'device') {
            try {
                await markDiscountUsedApi();   // mỗi thiết bị chỉ dùng ưu đãi 5% đúng 1 lần
                _deviceStatus.discountUsed = true;
                checkDeviceDiscountCode();
                applyAllFilters();             // cập nhật lại badge giảm giá + giá gạch ngang trên lưới Shop
            } catch (err) {
                console.error('Không thể ghi nhận sử dụng mã giảm giá:', err);
            }
        }

        document.getElementById('buyModalMsg').textContent = 'Đã gửi yêu cầu cho Admin! Vui lòng chờ Admin đối chiếu ngân hàng và duyệt.';
        startBuyWait(result.deadlineMs, result.requestId);
    } catch (err) {
        submitBtn.disabled = false;
        document.getElementById('buyModalMsg').textContent = 'Lỗi: ' + err.message;
    }
}

// ============================================================
// TÀI KHOẢN KHÁCH HÀNG — đăng ký/đăng nhập bắt buộc trước khi mua acc / tham gia sự kiện.
// ============================================================
let _customerAuthMode = 'login'; // 'login' | 'register'
let _pendingCustomerAction = null; // { type: 'buy', code } | { type: 'event', eventId } — thực hiện tiếp ngay sau khi đăng nhập/đăng ký thành công

// true = đang ở màn hình "cổng" bắt buộc ngay sau enterWebsite() — chưa đăng nhập/đăng ký xong
// thì không có cách nào đóng modal để xem tiếp trang Shop (không có nút đóng, không bấm ra
// ngoài để tắt được). false = mở bình thường từ navbar hoặc trước khi mua, đóng được như cũ.
let _authGateMandatory = false;

// Gọi ngay sau khi khách bấm "Ấn vào đây để tiếp tục" mà chưa đăng nhập — mở modal ở chế độ
// bắt buộc, mặc định tab "Đăng Nhập" (khách bấm chuyển sang "Đăng Ký" nếu chưa có tài khoản).
function openCustomerAuthGate() {
    _authGateMandatory = true;
    openCustomerAuthModal('login');
}

// Nút trên navbar: hiện "Đăng Nhập" (mở modal) nếu chưa đăng nhập, hoặc "Tên khách (Đăng xuất)"
// nếu đã đăng nhập — bấm vào khi đã đăng nhập sẽ hỏi xác nhận đăng xuất.
function refreshCustomerAuthUI() {
    const label = document.getElementById('customerAuthNavLabel');
    if (!label) return;
    if (isCustomerLoggedIn()) {
        label.textContent = `${getCustomerUsername()} (Đăng xuất)`;
    } else {
        label.textContent = 'Đăng Nhập';
    }
}

function openCustomerAuthModalOrAccount() {
    if (isCustomerLoggedIn()) {
        if (confirm(`Bạn đang đăng nhập với tài khoản "${getCustomerUsername()}". Đăng xuất ngay bây giờ?`)) {
            customerLogoutApi().then(refreshCustomerAuthUI);
        }
        return;
    }
    _authGateMandatory = false; // mở từ navbar luôn đóng được, không phải cổng bắt buộc
    openCustomerAuthModal('login');
}

function openCustomerAuthModal(mode) {
    _customerAuthMode = mode || 'login';
    document.getElementById('customerAuthUsername').value = '';
    document.getElementById('customerAuthPassword').value = '';
    document.getElementById('customerAuthMsg').textContent = '';
    applyCustomerAuthMode();
    const modalEl = document.getElementById('customerAuthModal');
    modalEl.classList.add('active');
    modalEl.classList.toggle('mandatory', _authGateMandatory);
}
function closeCustomerAuthModal() {
    // Ở chế độ bắt buộc (cổng vào sau enterWebsite), không có nút đóng để bấm nên hàm này chỉ
    // có thể được gọi lại bởi chính app (ví dụ mở modal quên mật khẩu, hoặc sau khi đăng
    // nhập/đăng ký thành công) — cứ đóng bình thường, việc "bắt buộc" nằm ở chỗ ẩn nút đóng
    // trong CSS/HTML, không phải chặn hàm này.
    document.getElementById('customerAuthModal').classList.remove('active');
    _pendingCustomerAction = null;
}
function applyCustomerAuthMode() {
    const isLogin = _customerAuthMode === 'login';
    document.getElementById('customerAuthTitle').textContent = isLogin ? 'Đăng Nhập Tài Khoản' : 'Đăng Ký Tài Khoản Mới';
    document.getElementById('customerAuthSubmitBtn').textContent = isLogin ? 'Đăng Nhập' : 'Đăng Ký';
    document.getElementById('customerAuthToggleLink').textContent = isLogin ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập';
}
function toggleCustomerAuthMode() {
    _customerAuthMode = _customerAuthMode === 'login' ? 'register' : 'login';
    document.getElementById('customerAuthMsg').textContent = '';
    applyCustomerAuthMode();
}

// Gọi trước khi mở luồng mua/tham gia sự kiện — nếu chưa đăng nhập thì lưu lại thao tác đang
// định làm (pendingCustomerAction) và mở modal đăng nhập, thực hiện tiếp ngay khi thành công.
function requireCustomerLoginOrPrompt(action) {
    if (isCustomerLoggedIn()) return true;
    _pendingCustomerAction = action;
    _authGateMandatory = false; // đây là gợi ý đăng nhập trước khi mua, không phải cổng bắt buộc
    openCustomerAuthModal('login');
    return false;
}

function resumePendingCustomerAction() {
    const action = _pendingCustomerAction;
    _pendingCustomerAction = null;
    if (!action) return;
    if (action.type === 'buy') openBuyModal(action.code);
    else if (action.type === 'event') openEventQrModal(action.eventId);
}

async function submitCustomerAuth() {
    const username = document.getElementById('customerAuthUsername').value.trim();
    const password = document.getElementById('customerAuthPassword').value;
    const msgEl = document.getElementById('customerAuthMsg');
    const btn = document.getElementById('customerAuthSubmitBtn');
    msgEl.textContent = '';

    if (!username || !password) {
        msgEl.textContent = 'Vui lòng nhập đầy đủ tên tài khoản và mật khẩu.';
        return;
    }

    btn.disabled = true;
    try {
        if (_customerAuthMode === 'login') {
            await customerLoginApi(username, password);
        } else {
            await customerRegisterApi(username, password);
        }
        _authGateMandatory = false;
        refreshCustomerAuthUI();
        closeCustomerAuthModal();
        resumePendingCustomerAction();
    } catch (err) {
        msgEl.textContent = err.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    } finally {
        btn.disabled = false;
    }
}

// Được data.js gọi khi token khách hết hạn/tài khoản bị khóa giữa chừng — cập nhật lại nút navbar.
function onCustomerSessionExpired() {
    refreshCustomerAuthUI();
}

// --- Quên mật khẩu: gửi yêu cầu lên máy chủ rồi mở Zalo để khách chủ động xác minh với Admin ---
function openCustomerForgotModal() {
    closeCustomerAuthModal();
    document.getElementById('customerForgotUsername').value = document.getElementById('customerAuthUsername').value.trim();
    document.getElementById('customerForgotMsg').textContent = '';
    document.getElementById('customerForgotModal').classList.add('active');
}
function closeCustomerForgotModal() {
    document.getElementById('customerForgotModal').classList.remove('active');
    // Nếu đang ở cổng bắt buộc và khách vẫn chưa đăng nhập, mở lại modal đăng nhập/đăng ký
    // thay vì để lộ trang Shop ra ngoài mà chưa qua bước đăng nhập/đăng ký.
    if (_authGateMandatory && !isCustomerLoggedIn()) {
        openCustomerAuthModal(_customerAuthMode);
    }
}
async function submitCustomerForgot() {
    const username = document.getElementById('customerForgotUsername').value.trim();
    const msgEl = document.getElementById('customerForgotMsg');
    if (!username) {
        msgEl.textContent = 'Vui lòng nhập tên tài khoản.';
        return;
    }
    try {
        const result = await customerRecoveryRequestApi(username, '');
        msgEl.style.color = '#10b981';
        msgEl.textContent = result.message || 'Đã gửi yêu cầu.';
        const zaloUrl = (getSettings().socialLinks && getSettings().socialLinks.zalo) || 'https://zalo.me/0362062410';
        const separator = zaloUrl.includes('?') ? '&' : '?';
        const text = encodeURIComponent(`Admin oi, toi quen mat khau tai khoan "${username}" tren Shop, nho Admin xac minh va cap lai giup em.`);
        window.open(`${zaloUrl}${separator}text=${text}`, '_blank');
    } catch (err) {
        msgEl.style.color = '#f87171';
        msgEl.textContent = err.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    }
}

document.addEventListener('DOMContentLoaded', refreshCustomerAuthUI);
