// ============================================================
// script.js — Logic trang khách hàng (đã tối ưu + mở rộng)
// Yêu cầu: data.js phải được nạp trước file này.
// ============================================================

const CLIENT_STATUS_LABELS = {
    selling: { badge: '<span class="acc-status-badge badge-selling">Đang bán</span>', disabled: false, btnText: 'Mua Ngay' },
    sold: { badge: '<span class="acc-status-badge badge-sold">Đã bán</span>', disabled: true, btnText: 'Không Khả Dụng' },
    banned: { badge: '<span class="acc-status-badge badge-banned">Bị ban</span>', disabled: true, btnText: 'Không Khả Dụng' },
    hacked: { badge: '<span class="acc-status-badge badge-hacked">Tạm Khóa (Nghi Hack)</span>', disabled: true, btnText: 'Đang Tạm Khóa' }
};

// Chạy khi tải trang xong
document.addEventListener("DOMContentLoaded", async () => {
    await loadSettingsToClient();
    await renderAccounts(getAccounts());
    initAudioPlayer();
    checkDeviceDiscountCode();
    bindShopGridEvents();     // event delegation: 1 listener duy nhất thay vì N onclick nội tuyến
    bindSearchDebounce();     // tránh render lại toàn bộ lưới trên mỗi phím gõ
    renderPromoWheelStatus(); // trạng thái vòng quay ưu đãi (1 lượt/tháng/thiết bị)
    renderFreeSpinStatus();   // trạng thái vòng quay acc random free (1 lượt/ngày/thiết bị)
});

// Tải cấu hình cài đặt từ Admin lên Client (logo, avatar, nhạc, social links, giới thiệu)
async function loadSettingsToClient() {
    const settings = getSettings();
    const titleEl = document.getElementById('introAdminTitle');
    const introEl = document.getElementById('displayIntroText');
    const audio = document.getElementById('bgAudio');

    if (titleEl) titleEl.textContent = settings.adminTitle;
    if (introEl) introEl.innerHTML = settings.introText;

    // Logo / avatar có thể là URL thường hoặc ảnh admin tải lên từ máy (idb:...)
    const [logoSrc, avatarSrc, audioSrc] = await Promise.all([
        resolveMediaSrc(settings.logoUrl, DEFAULT_LOGO),
        resolveMediaSrc(settings.avatarUrl, DEFAULT_LOGO),
        resolveMediaSrc(settings.audioUrl, '')
    ]);

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
function enterWebsite() {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) overlay.classList.add('hidden');

    const audio = document.getElementById('bgAudio');
    if (audio && audio.src) {
        audio.play().catch(e => console.log("Trình duyệt chặn autoplay âm thanh:", e));
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
    display.textContent = isDiscountUsed()
        ? `Mã định danh: ${deviceCode} (Đã sử dụng ưu đãi 5%)`
        : `Mã định danh: ${deviceCode} (Còn hiệu lực giảm 5%, không áp dụng cho Acc Reg)`;
}

function claimDiscountCode() {
    const code = getOrCreateDeviceCode();
    navigator.clipboard.writeText(code);
    if (isDiscountUsed()) {
        alert(`Mã ${code} đã được sử dụng trên thiết bị này rồi. Mỗi thiết bị chỉ được áp dụng ưu đãi 5% một lần duy nhất.`);
    } else {
        alert(`Đã sao chép mã giảm giá: ${code}. Ưu đãi 5% sẽ tự động áp khi bạn mua acc (trừ Acc Reg)!`);
    }
}

// ============================================================
// Vòng quay may mắn (tab Ưu Đãi) — xác suất trúng thật 1/1000, 1 lượt / thiết bị / tháng.
// ============================================================
let isSpinning = false;

function renderPromoWheelStatus() {
    const state = getPromoWheelState();
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

function spinWheel() {
    if (isSpinning) return;
    const state = getPromoWheelState();
    if (state.spun) {
        renderPromoWheelStatus();
        return;
    }

    isSpinning = true;
    const btn = document.getElementById('promoSpinBtn');
    if (btn) btn.disabled = true;
    const wheel = document.getElementById('wheelCircle');

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    setTimeout(() => {
        isSpinning = false;
        const result = spinPromoWheel(); // xác suất trúng thật 1/1000, chỉ tiêu tốn lượt đúng 1 lần
        if (result.won) {
            alert("🎉 Chúc mừng! Bạn đã may mắn trúng phần thưởng lớn từ Shop J-Hush! Hãy liên hệ Zalo Admin để nhận thưởng.");
        } else {
            alert("Chúc bạn may mắn lần sau! Mỗi thiết bị có 1 lượt quay mỗi tháng, hẹn gặp lại vào tháng sau.");
        }
        renderPromoWheelStatus();
    }, 4000);
}

// ============================================================
// Vòng quay Acc Random Free (trang riêng) — xác suất trúng thật 1/1000, 1 lượt / thiết bị / ngày.
// Trúng thưởng thì hiển thị thông tin acc minh bạch ngay lập tức.
// ============================================================
let isFreeSpinning = false;

function renderFreeSpinStatus() {
    const state = getFreeSpinState();
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

function spinFreeWheel() {
    if (isFreeSpinning) return;
    const state = getFreeSpinState();
    if (state.spun) {
        renderFreeSpinStatus();
        return;
    }

    isFreeSpinning = true;
    const btn = document.getElementById('freeSpinBtn');
    if (btn) btn.disabled = true;
    const wheel = document.getElementById('freeWheelCircle');

    const randomDeg = Math.floor(3600 + Math.random() * 360);
    wheel.style.transform = `rotate(${randomDeg}deg)`;

    setTimeout(() => {
        isFreeSpinning = false;
        const result = spinFreeAccount(); // xác suất trúng thật 1/1000, minh bạch
        if (result.won && result.prize) {
            alert(`🎉 Chúc mừng! Bạn đã quay trúng acc [${result.prize.code}] miễn phí! Thông tin acc đã hiển thị bên dưới.`);
            showFreeAccPrize(result.prize);
        } else {
            alert("Chúc bạn may mắn lần sau! Mỗi thiết bị có 1 lượt quay mỗi ngày, hẹn gặp lại ngày mai.");
        }
        renderFreeSpinStatus();
    }, 4000);
}

// Hiển thị danh sách tài khoản (dùng DocumentFragment để giảm số lần reflow)
// Ảnh acc có thể là URL thường hoặc ảnh admin tải lên từ máy (idb:...) nên hàm này là async.
async function renderAccounts(accountsToRender) {
    const grid = document.getElementById('accountGrid');
    if (!grid) return;

    if (accountsToRender.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1;">Không tìm thấy tài khoản phù hợp.</p>';
        return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300';
    const imgSources = await Promise.all(accountsToRender.map(acc => resolveMediaSrc(acc.img, fallbackImg)));

    const fragment = document.createDocumentFragment();

    accountsToRender.forEach((acc, i) => {
        const statusInfo = CLIENT_STATUS_LABELS[acc.status] || CLIENT_STATUS_LABELS.selling;
        const typeInfo = ACCOUNT_TYPE_LABELS[acc.type] || ACCOUNT_TYPE_LABELS.reg;

        const card = document.createElement('div');
        card.className = 'acc-card hover-card';
        // data-* thay cho onclick nội tuyến kèm chuỗi nối tay -> an toàn hơn & nhanh hơn
        card.innerHTML = `
            <div class="acc-img-wrap">
                <img src="${escapeHtml(imgSources[i])}" alt="Ảnh acc ${escapeHtml(acc.code)}" loading="lazy">
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
async function openBuyModal(code) {
    const acc = getAccounts().find(a => a.code === code);
    if (!acc) return;

    currentBuyingCode = acc.code;

    const eligibleDiscount = isEligibleForDiscount(acc);
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

    // Ưu tiên dùng ảnh QR admin tự tải lên từ thiết bị; nếu không có thì tự sinh qua VietQR
    // theo đúng số tiền (đã áp giảm giá nếu có) và nội dung chuyển khoản.
    const qrImg = document.getElementById('modalQrImg');
    if (settings.qrImageUrl) {
        qrImg.src = await resolveMediaSrc(settings.qrImageUrl, '');
    } else {
        qrImg.src = `https://img.vietqr.io/image/${encodeURIComponent(bankName)}-${encodeURIComponent(bankAcc)}-compact2.png?amount=${finalPrice}&addInfo=${encodeURIComponent(syntax)}&accountName=${encodeURIComponent(settings.bankOwner || 'VU HUY DUC')}`;
    }

    document.getElementById('buyModal').classList.add('active');
}

function closeModal() {
    document.getElementById('buyModal').classList.remove('active');
}

function confirmPaymentZalo() {
    if (currentDiscountApplied) {
        markDiscountUsed();   // mỗi thiết bị chỉ dùng ưu đãi 5% đúng 1 lần
        checkDeviceDiscountCode();
    }

    const discountNote = currentDiscountApplied ? ' (đã áp giảm 5%)' : '';
    alert(`Đã ghi nhận yêu cầu mua mã tài khoản [${currentBuyingCode}]${discountNote}. Hệ thống sẽ chuyển hướng bạn sang Zalo Admin để xác thực giao dịch chuyển khoản. Lưu ý chuyển đúng số tiền: ${formatVND(currentBuyingPrice)}.`);

    const zaloUrl = (getSettings().socialLinks && getSettings().socialLinks.zalo) || 'https://zalo.me/0362062410';
    const separator = zaloUrl.includes('?') ? '&' : '?';
    const text = encodeURIComponent(`Admin oi, toi da thanh toan don hang ${currentBuyingCode} gia ${currentBuyingPrice}d${currentDiscountApplied ? ' (da ap giam 5%)' : ''}`);
    window.open(`${zaloUrl}${separator}text=${text}`, '_blank');
    closeModal();
}
