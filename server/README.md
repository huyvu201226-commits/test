# Shop J-Hush — Backend (Node.js)

Toàn bộ dữ liệu (acc, acc free, cấu hình, sự kiện, nhật ký) giờ lưu **trên máy chủ**
trong file `data/db.json` (tự tạo/ghi đè khi có thay đổi), thay vì `localStorage` của
từng trình duyệt như trước — mọi khách truy cập đều thấy cùng 1 dữ liệu, và thay đổi
của admin sẽ tồn tại vĩnh viễn kể cả khi xóa cache trình duyệt.

## Cài đặt & chạy

```bash
cd server
npm install
npm start
```

Mặc định chạy ở cổng `3000` (đổi bằng biến môi trường `PORT`, ví dụ `PORT=8080 npm start`).

Mật khẩu quản trị mặc định lần đầu: **admin123** (đổi ngay trong trang Admin → "Đổi Mật Khẩu Quản Trị").

## Cấu trúc

- `server.js` — toàn bộ API (Express).
- `data/db.json` — "cơ sở dữ liệu" dạng file JSON, tự động ghi lại mỗi khi có thay đổi.
- `uploads/` — nơi lưu ảnh/nhạc admin tải lên từ trang Quản Trị, phục vụ qua đường dẫn `/uploads/...`.

## Kết nối với frontend (index.html / admin.html)

Frontend gọi API qua biến `API_BASE_URL` khai báo ở đầu file `data.js`. Nếu bạn deploy
frontend và backend **cùng domain** (ví dụ Express serve luôn cả file tĩnh, hoặc dùng
reverse proxy Nginx để `/api` trỏ vào Node), để nguyên giá trị mặc định `''` (rỗng — dùng
luôn domain hiện tại). Nếu deploy **khác domain** (VD frontend ở Vercel/Netlify, backend ở
Railway/Render), sửa `API_BASE_URL` thành URL đầy đủ của backend, ví dụ:

```js
const API_BASE_URL = 'https://jhush-api.onrender.com';
```

## Gợi ý deploy nhanh

- **Railway / Render**: tạo service Node.js mới, trỏ vào thư mục `server/`, lệnh build
  `npm install`, lệnh start `npm start`. Nhớ mở "Persistent Disk"/volume nếu có, để
  `data/db.json` và `uploads/` không bị mất khi server khởi động lại (một số nền tảng free
  tier có filesystem tạm thời — nếu vậy, cân nhắc nâng cấp lên gói có ổ đĩa bền, hoặc đổi
  sang một DB thật như PostgreSQL/MongoDB sau này).
- **VPS riêng (Ubuntu)**: cài Node.js 18+, `pm2 start server.js` để chạy nền + tự khởi
  động lại khi crash, dùng Nginx làm reverse proxy + SSL (Let's Encrypt) ra domain thật,
  proxy cả `/api` và các file tĩnh (`index.html`, `admin.html`, `style.css`, `script.js`,
  `admin.js`, `data.js`) về Node hoặc phục vụ tĩnh qua chính Nginx.

## Giới hạn hiện tại (để biết mà nâng cấp sau nếu cần)

- Phiên đăng nhập Admin lưu trong bộ nhớ (RAM) — khởi động lại server thì admin phải đăng
  nhập lại (dữ liệu shop thì KHÔNG mất, chỉ có phiên đăng nhập là mất).
- File JSON phù hợp cho quy mô shop nhỏ/vừa; nếu lượng truy cập và dữ liệu lớn lên nhiều,
  nên chuyển `data/db.json` sang một database thật (PostgreSQL/MySQL/MongoDB) — có thể làm
  dần từng bảng mà không cần đổi các route API đang có.
