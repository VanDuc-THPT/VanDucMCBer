"use strict";
/**
 * TikSave Pro backend. Không cần cài thư viện, chạy trên Node 18 trở lên.
 *
 *  GET  /api/health     trạng thái máy chủ
 *  POST /api/analyze    { url, owner } -> thông tin video qua oEmbed chính thức của TikTok
 *  GET  /api/thumb      chuyển tiếp ảnh bìa từ CDN của TikTok (kèm ?download=1 để tải)
 *
 * Tải video: máy chủ không tự bóc tách hay xóa dấu nhận diện. Muốn bật nút tải, hãy đặt
 * DOWNLOAD_PROVIDER_URL trỏ tới dịch vụ hợp lệ mà bạn có quyền dùng (xem README).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ""; // ví dụ https://tenban.github.io
const PROVIDER_URL = process.env.DOWNLOAD_PROVIDER_URL || ""; // ví dụ https://dichvu.example/api?url={url}
const PROVIDER_KEY = process.env.DOWNLOAD_PROVIDER_KEY || "";
const PUBLIC_DIR = path.join(__dirname, "public");
const UA = "TikSavePro/3.0 (+oembed client)";

/* ---------- Tiện ích ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon"
};

function send(res, status, body, headers) {
  const h = Object.assign({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }, headers || {});
  if (typeof body === "object" && !Buffer.isBuffer(body)) {
    h["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(body);
  }
  res.writeHead(status, h);
  res.end(body);
}
const fail = (res, status, error, message) => send(res, status, { error, message });

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* Giới hạn tốc độ đơn giản theo IP: 30 yêu cầu mỗi phút */
const hits = new Map();
function limited(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").toString().split(",")[0].trim();
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < 60000);
  rec.push(now);
  hits.set(ip, rec);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
  return rec.length > 30;
}

function readJson(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("bad_json")); }
    });
    req.on("error", reject);
  });
}

/* ---------- Kiểm tra liên kết (chống SSRF) ---------- */
const TIKTOK_HOST = /^(?:[a-z0-9-]+\.)*tiktok\.com$/i;
const CDN_HOST = /^(?:[a-z0-9-]+\.)*(?:tiktokcdn(?:-us|-eu)?\.com|tiktok\.com|tiktokv\.com|ibytedtos\.com|byteoversea\.com)$/i;

function parseTikTok(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!TIKTOK_HOST.test(u.hostname) || u.port) return null;
  u.protocol = "https:";
  u.hash = "";
  return u;
}

async function timedFetch(url, opts = {}, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, Object.assign({ headers: { "User-Agent": UA }, signal: ctl.signal }, opts));
  } finally { clearTimeout(timer); }
}

/* Liên kết rút gọn (vm.tiktok.com, vt.tiktok.com) cần mở rộng, chỉ đi theo chuyển hướng về TikTok */
async function expand(u) {
  let cur = u;
  for (let i = 0; i < 4; i++) {
    if (/\/video\/\d+/.test(cur.pathname)) return cur;
    const r = await timedFetch(cur.href, { redirect: "manual" });
    const loc = r.headers.get("location");
    if (!loc || r.status < 300 || r.status > 399) return cur;
    const next = parseTikTok(new URL(loc, cur.href).href);
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

/* ---------- Nhà cung cấp tải (tùy chọn) ---------- */
async function providerDownloads(videoUrl) {
  if (!PROVIDER_URL) return null;
  const endpoint = PROVIDER_URL.replace("{url}", encodeURIComponent(videoUrl));
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (PROVIDER_KEY) headers.Authorization = "Bearer " + PROVIDER_KEY;
  const r = await timedFetch(endpoint, { headers }, 15000);
  if (!r.ok) throw new Error("provider_" + r.status);
  const data = await r.json();
  // Định dạng mong đợi: { downloads: [{ label: "1080p", url: "https://...", noMark: false }] }
  const list = Array.isArray(data.downloads) ? data.downloads : [];
  return list
    .filter((d) => d && typeof d.url === "string" && /^https:\/\//i.test(d.url) && typeof d.label === "string")
    .slice(0, 6)
    .map((d) => ({ label: d.label.slice(0, 24), url: d.url, noMark: d.noMark === true }));
}

/* ---------- API ---------- */
async function analyze(req, res) {
  let body;
  try { body = await readJson(req); } catch (e) {
    return fail(res, 400, e.message, "Yêu cầu không hợp lệ.");
  }
  const parsed = parseTikTok(body.url);
  if (!parsed) return fail(res, 400, "invalid_url", "Liên kết này không phải của TikTok.");

  let target;
  try { target = await expand(parsed); } catch { target = parsed; }

  let oembed;
  try {
    const r = await timedFetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(target.href));
    if (r.status === 400 || r.status === 404) return fail(res, 404, "not_found", "Không tìm thấy video. Video có thể đã bị xóa hoặc ở chế độ riêng tư.");
    if (!r.ok) throw new Error("oembed_" + r.status);
    oembed = await r.json();
  } catch (e) {
    return fail(res, 502, "upstream", "TikTok chưa phản hồi. Hãy thử lại sau ít phút.");
  }

  const out = {
    url: target.origin + target.pathname,
    title: String(oembed.title || "").trim() || "Video TikTok",
    author: oembed.author_name || "",
    authorUrl: oembed.author_url || "",
    thumbnail: oembed.thumbnail_url || "",
    downloadsEnabled: Boolean(PROVIDER_URL),
    downloads: []
  };

  if (body.owner === true && PROVIDER_URL) {
    try { out.downloads = (await providerDownloads(out.url)) || []; }
    catch { out.downloadError = true; }
  }
  return send(res, 200, out, { "Cache-Control": "no-store" });
}

async function thumb(req, res, url) {
  const src = url.searchParams.get("url") || "";
  let u;
  try { u = new URL(src); } catch { return fail(res, 400, "invalid_url", "Địa chỉ ảnh không hợp lệ."); }
  if (u.protocol !== "https:" || !CDN_HOST.test(u.hostname) || u.port) return fail(res, 400, "blocked", "Nguồn ảnh không được hỗ trợ.");
  try {
    const r = await timedFetch(u.href, { redirect: "error" });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || !/^image\//i.test(type)) return fail(res, 502, "upstream", "Không tải được ảnh bìa.");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return fail(res, 413, "too_large", "Ảnh quá lớn.");
    const headers = { "Content-Type": type, "Cache-Control": "public, max-age=3600" };
    if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = 'attachment; filename="tiksave-cover.jpg"';
    return send(res, 200, buf, headers);
  } catch { return fail(res, 502, "upstream", "Không tải được ảnh bìa."); }
}

/* ---------- Tệp tĩnh ---------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) return fail(res, 403, "forbidden", "Không có quyền truy cập.");
  fs.readFile(file, (err, data) => {
    if (err) {
      if (rel === "/index.html") return fail(res, 404, "missing", "Thiếu thư mục public.");
      return fail(res, 404, "not_found", "Không tìm thấy trang.");
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const cache = file.endsWith("sw.js") ? "no-cache" : "public, max-age=300";
    send(res, 200, data, { "Content-Type": type, "Cache-Control": cache });
  });
}

/* ---------- Máy chủ ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      cors(req, res);
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      if (limited(req)) return fail(res, 429, "rate_limited", "Bạn thao tác quá nhanh. Hãy thử lại sau một phút.");
      if (url.pathname === "/api/health" && req.method === "GET") return send(res, 200, { ok: true, downloads: Boolean(PROVIDER_URL) });
      if (url.pathname === "/api/analyze" && req.method === "POST") return await analyze(req, res);
      if (url.pathname === "/api/thumb" && req.method === "GET") return await thumb(req, res, url);
      return fail(res, 404, "not_found", "Đường dẫn không tồn tại.");
    }
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "method", "Phương thức không được hỗ trợ.");
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, "server", "Máy chủ gặp lỗi.");
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`TikSave Pro chạy tại http://localhost:${PORT}  (tải video: ${PROVIDER_URL ? "bật" : "chưa cấu hình"})`));
}
module.exports = { server, parseTikTok };
