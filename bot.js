require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = process.env.API_URL || process.env.SOURCE_API || 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const POLL_MS = Math.max(2000, Number(process.env.POLL_MS || 5000));
const HISTORY_SIZE = Math.max(30, Number(process.env.HISTORY_SIZE || 100));

if (!TOKEN || TOKEN === 'THAY_TOKEN_BOT_TELEGRAM') {
  console.error('ERROR: Thiếu TELEGRAM_BOT_TOKEN. Hãy thêm biến môi trường trên Render.');
  process.exit(1);
}

// Telegram long polling phù hợp với Render Background Worker.
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 25 }
  }
});

const subscribers = new Set();
let history = [];
let lastSessionId = null;
let pollingBusy = false;

function normalizeResult(value) {
  const s = String(value ?? '').toLowerCase();
  if (s.includes('tài') || s.includes('tai')) return 'TÀI';
  if (s.includes('xỉu') || s.includes('xiu')) return 'XỈU';
  return '';
}

function getId(x) {
  return x?.id ?? x?._id ?? x?.sessionId ?? x?.session_id;
}

async function getHistory() {
  const response = await axios.get(API_URL, {
    timeout: 10000,
    headers: { 'User-Agent': 'telegram-taixiu-bot/2.0' }
  });

  const raw = response.data;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.list)
      ? raw.list
      : Array.isArray(raw?.data)
        ? raw.data
        : [];

  if (!list.length) {
    throw new Error('API không trả về danh sách phiên');
  }

  return list
    .slice()
    .sort((a, b) => Number(getId(b) || 0) - Number(getId(a) || 0))
    .map(x => ({
      id: getId(x),
      result: normalizeResult(x.resultTruyenThong ?? x.result ?? x.ket_qua),
      total: Number(x.point ?? x.total ?? x.sum ?? 0),
      dice: Array.isArray(x.dices)
        ? x.dices.map(Number)
        : Array.isArray(x.dice)
          ? x.dice.map(Number)
          : []
    }))
    .filter(x => x.id != null && x.result)
    .slice(0, HISTORY_SIZE);
}

// Phân tích thống kê tần suất + xu hướng. Không đảm bảo kết quả tương lai.
function analyze(rows) {
  const h = rows.slice(0, 30);
  if (!h.length) {
    return { prediction: 'CHƯA ĐỦ DỮ LIỆU', confidence: 0, tai: 0, xiu: 0, score: 0 };
  }

  const tai = h.filter(x => x.result === 'TÀI').length;
  const xiu = h.length - tai;

  let score = 0;
  h.forEach((x, i) => {
    const weight = Math.max(1, 10 - i * 0.3);
    score += x.result === 'TÀI' ? weight : -weight;
  });

  const prediction = score >= 0 ? 'TÀI' : 'XỈU';
  const balance = Math.abs(tai - xiu) / h.length;
  const trend = Math.min(1, Math.abs(score) / 35);
  const confidence = Math.round(Math.max(50, Math.min(85, 50 + balance * 30 + trend * 20)));

  return { prediction, confidence, tai, xiu, score };
}

function predictionText() {
  const a = analyze(history);
  return [
    '🤖 PHÂN TÍCH TÀI/XỈU',
    '',
    `Dự đoán thống kê: ${a.prediction}`,
    `Độ tin cậy nội bộ: ${a.confidence}%`,
    `30 phiên: TÀI ${a.tai} | XỈU ${a.xiu}`,
    `Điểm xu hướng: ${a.score.toFixed(1)}`,
    '',
    '⚠️ Chỉ là phân tích dữ liệu lịch sử, không đảm bảo kết quả tương lai.'
  ].join('\n');
}

async function refresh() {
  const rows = await getHistory();
  history = rows;
  return rows[0] || null;
}

async function safeSend(chatId, text) {
  try {
    await bot.sendMessage(chatId, text);
    return true;
  } catch (err) {
    // Chat đã chặn bot/xóa chat thì bỏ khỏi danh sách thông báo.
    if (err?.response?.body?.error_code === 403) subscribers.delete(chatId);
    return false;
  }
}

bot.onText(/^\/(start|help)$/i, async msg => {
  subscribers.add(msg.chat.id);
  await safeSend(msg.chat.id,
`🎲 BOT TÀI XỈU\n\n` +
`Bot đang kết nối API bàn và có thể phục vụ nhiều người cùng lúc.\n\n` +
`/du_doan - phân tích phiên kế tiếp\n` +
`/lich_su - xem 10 phiên gần nhất\n` +
`/bat - bật thông báo phiên mới\n` +
`/tat - tắt thông báo phiên mới\n` +
`/id - xem Chat ID\n\n` +
`⚠️ Phân tích chỉ dựa trên dữ liệu lịch sử, không đảm bảo kết quả.`);
});

bot.onText(/^\/id$/i, msg => safeSend(msg.chat.id, `Chat ID: ${msg.chat.id}`));

bot.onText(/^\/bat$/i, msg => {
  subscribers.add(msg.chat.id);
  safeSend(msg.chat.id, '🔔 Đã bật thông báo phiên mới.');
});

bot.onText(/^\/tat$/i, msg => {
  subscribers.delete(msg.chat.id);
  safeSend(msg.chat.id, '🔕 Đã tắt thông báo phiên mới.');
});

bot.onText(/^\/du_doan$/i, async msg => {
  try {
    await refresh();
    await safeSend(msg.chat.id, predictionText());
  } catch (err) {
    await safeSend(msg.chat.id, `❌ Không đọc được API: ${err.message}`);
  }
});

bot.onText(/^\/lich_su$/i, async msg => {
  try {
    await refresh();
    const rows = history.slice(0, 10);
    const text = rows.map(x =>
      `#${x.id}: ${x.result} | Tổng ${x.total}${x.dice.length ? ` | ${x.dice.join('-')}` : ''}`
    ).join('\n');
    await safeSend(msg.chat.id, `📊 10 phiên gần nhất\n\n${text || 'Không có dữ liệu.'}`);
  } catch (err) {
    await safeSend(msg.chat.id, `❌ API lỗi: ${err.message}`);
  }
});

async function checkNewSession() {
  if (pollingBusy) return;
  pollingBusy = true;
  try {
    const latest = await refresh();
    if (!latest) return;
    if (String(latest.id) === String(lastSessionId)) return;
    lastSessionId = latest.id;

    const a = analyze(history);
    const message = [
      `🎲 PHIÊN MỚI #${latest.id}`,
      `Kết quả: ${latest.result}`,
      `Xúc xắc: ${latest.dice.length ? latest.dice.join(' - ') : 'N/A'} | Tổng: ${latest.total}`,
      '',
      `🤖 Phân tích phiên kế tiếp: ${a.prediction}`,
      `Độ tin cậy nội bộ: ${a.confidence}%`,
      '',
      '⚠️ Dự đoán chỉ mang tính thống kê.'
    ].join('\n');

    for (const chatId of subscribers) {
      await safeSend(chatId, message);
    }
  } catch (err) {
    console.error(`[API] ${new Date().toISOString()} ${err.message}`);
  } finally {
    pollingBusy = false;
  }
}

const timer = setInterval(checkNewSession, POLL_MS);

bot.on('polling_error', err => {
  console.error(`[Telegram] ${new Date().toISOString()} ${err.message}`);
});

async function shutdown(signal) {
  console.log(`${signal}: đang tắt bot...`);
  clearInterval(timer);
  try { await bot.stopPolling(); } catch (_) {}
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

(async () => {
  try {
    await refresh();
    lastSessionId = history[0]?.id ?? null;
    console.log(`Bot started. API=${API_URL} POLL_MS=${POLL_MS} HISTORY_SIZE=${HISTORY_SIZE}`);
  } catch (err) {
    console.warn(`Khởi động thành công nhưng chưa đọc được API: ${err.message}`);
  }
})();
