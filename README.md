# TikSave Pro v3.0

Giao diện glassmorphism (navy đen + tím neon, Dark/Light) và backend Node.js để xem trước video TikTok. Không cần cài thư viện nào.

## Chạy thử trên máy

```bash
cd tiksave-pro
node server.js
```

Mở http://localhost:3000. Cần Node 18 trở lên.

## Những gì đã có

- Dán liên kết, phân tích, xem ảnh bìa, tiêu đề, tác giả (qua oEmbed chính thức của TikTok).
- Lịch sử trong LocalStorage: tìm kiếm, phân tích lại, sao chép, xóa từng mục hoặc xóa tất cả.
- Cài đặt: giao diện sáng/tối, bật/tắt lịch sử, tự dán từ clipboard, giảm chuyển động, địa chỉ backend.
- Cài được lên màn hình chính Android (PWA).
- Backend chặn SSRF (chỉ chấp nhận tiktok.com), giới hạn 30 yêu cầu mỗi phút mỗi IP.

## Nút tải video

oEmbed chỉ trả về thông tin và ảnh bìa, không có tệp video. Vì vậy mặc định website cho xem trước và lưu ảnh bìa.
Để bật nút tải 1080p/720p/480p, trỏ backend tới một dịch vụ hợp lệ mà bạn có quyền dùng:

```bash
DOWNLOAD_PROVIDER_URL="https://dich-vu-cua-ban.example/api?url={url}" \
DOWNLOAD_PROVIDER_KEY="khoa-neu-co" \
node server.js
```

Dịch vụ cần trả JSON dạng:

```json
{ "downloads": [
  { "label": "1080p", "url": "https://..." },
  { "label": "720p",  "url": "https://..." }
] }
```

Chỉ liên kết `https` được chấp nhận. Backend chỉ gọi dịch vụ khi người dùng đã tích xác nhận quyền sở hữu. Nếu video do chính bạn đăng, cách đơn giản và đầy đủ chất lượng nhất là dùng tệp gốc trong máy hoặc chức năng lưu video có sẵn trong ứng dụng TikTok.

Dự án không xóa watermark hay dấu nhận diện nhằm che giấu nguồn gốc. Nút nào có nhãn "không logo" chỉ xuất hiện khi nhà cung cấp của bạn tự khai báo `"noMark": true`, và việc dùng bản đó thuộc trách nhiệm của bạn.

## Triển khai

**Cách 1, một nơi duy nhất (dễ nhất):** đưa cả thư mục lên Render, Railway hoặc Fly.io. Lệnh chạy là `node server.js`. Backend tự phục vụ luôn giao diện.

**Cách 2, GitHub Pages + backend riêng:**
1. Đưa thư mục `public/` lên GitHub Pages.
2. Chạy `server.js` ở một dịch vụ khác và đặt `ALLOWED_ORIGIN=https://tenban.github.io`.
3. Trong `public/config.js` điền `window.TIKSAVE_API = "https://backend-cua-ban.example";`. Hoặc nhập địa chỉ trong trang Cài đặt.

**Cách 3, Vercel:** đưa `public/` làm trang tĩnh, còn backend chạy riêng như cách 2. `server.js` là máy chủ Node thường, không phải hàm serverless.

## Biến môi trường

| Tên | Ý nghĩa |
| --- | --- |
| `PORT` | Cổng chạy, mặc định 3000 |
| `ALLOWED_ORIGIN` | Địa chỉ website được phép gọi API, để trống thì cho mọi nơi |
| `DOWNLOAD_PROVIDER_URL` | Địa chỉ dịch vụ tải, chứa `{url}` |
| `DOWNLOAD_PROVIDER_KEY` | Khóa gửi kèm dạng Bearer, nếu có |

## Cấu trúc

```
server.js            backend
public/index.html    giao diện
public/style.css     glassmorphism, Dark/Light
public/app.js        logic, lịch sử, GSAP
public/config.js     địa chỉ backend
public/sw.js         lưu sẵn giao diện
```
