# Telegram Tài Xỉu Bot — Render Edition

Bot Node.js chạy bằng **Render Background Worker**, dùng Telegram long polling và đọc dữ liệu từ API bàn.

## 1. Deploy nhanh bằng GitHub + Render

### Bước A — đưa source lên GitHub

Giải nén project, tạo một repository mới trên GitHub rồi upload 5 file:

- `bot.js`
- `package.json`
- `render.yaml`
- `.gitignore`
- `.env.example`

Không upload file `.env` hoặc token Telegram.

### Bước B — tạo service trên Render

Trong Render chọn **New → Blueprint** và chọn repository chứa `render.yaml`.

Render sẽ đọc:

```yaml
buildCommand: npm install
startCommand: npm start
type: worker
```

### Bước C — thêm token

Trong Environment của service, đặt:

```text
TELEGRAM_BOT_TOKEN = token lấy từ @BotFather
```

Các biến còn lại đã có trong `render.yaml`:

```text
API_URL=https://wtxmd52.tele68.com/v1/txmd5/sessions
POLL_MS=5000
HISTORY_SIZE=100
```

## 2. Nếu tạo Worker thủ công

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Type: `Background Worker`

Environment Variables:

```text
TELEGRAM_BOT_TOKEN=...
API_URL=https://wtxmd52.tele68.com/v1/txmd5/sessions
POLL_MS=5000
HISTORY_SIZE=100
```

## 3. Bot hỗ trợ nhiều người

Mỗi người chỉ cần mở bot và gửi `/start`. Bot dùng `chat.id` để gửi phản hồi riêng cho từng người.

Các lệnh:

- `/start` hoặc `/help`
- `/du_doan`
- `/lich_su`
- `/bat`
- `/tat`
- `/id`

## 4. Lưu ý khi Render restart service

Danh sách người đăng ký thông báo hiện được giữ trong RAM. Vì vậy nếu Worker bị restart/deploy lại, người dùng cần gửi `/start` hoặc `/bat` lại để đăng ký thông báo.

Nếu muốn giữ danh sách người dùng vĩnh viễn, có thể bổ sung PostgreSQL/Redis ở bước sau.

## 5. Kiểm tra log

Sau khi deploy, Render Logs nên xuất hiện dòng tương tự:

```text
Bot started. API=https://wtxmd52.tele68.com/v1/txmd5/sessions POLL_MS=5000 HISTORY_SIZE=100
```

Nếu API tạm lỗi, Worker không tự thoát; nó sẽ tiếp tục thử ở chu kỳ kế tiếp.

## 6. Bảo mật

Không đưa `TELEGRAM_BOT_TOKEN` vào GitHub. Chỉ đặt token trong Render Environment Variables.

Phần phân tích hiện là thống kê tần suất + xu hướng lịch sử, không phải mô hình có thể đảm bảo kết quả tương lai.
