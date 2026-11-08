const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

// Đã nâng cấp lên User-Agent của iOS 18 mới nhất để qua Cloudflare dễ hơn
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Chặn địa chỉ nội bộ (SSRF): localhost, mạng LAN, metadata cloud... */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = String(ip).toLowerCase();
  if (v.startsWith('::ffff:')) {
    const rest = v.slice(7);
    return net.isIPv4(rest) ? isPrivateIp(rest) : true;
  }
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/** Chỉ cho phép http/https cổng 80/443, tên miền phân giải ra IP công cộng (và nằm trong ALLOWED_HOSTS nếu có đặt). */
async function assertPublic(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('URL không hợp lệ'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Chỉ hỗ trợ http/https');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Cổng không được phép');
  
  // SỬA LỖI: Gỡ bỏ ngoặc vuông của IPv6 (VD: [::1] -> ::1) để net.isIP nhận diện chuẩn xác
  const rawHost = u.hostname.replace(/^\[|\]$/g, '');

  const allow = (process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some((h) => rawHost === h || rawHost.endsWith('.' + h))) {
    throw new Error('Tên miền không nằm trong ALLOWED_HOSTS');
  }
  
  const ips = net.isIP(rawHost) ? [{ address: rawHost }] : await dns.lookup(rawHost, { all: true });
  if (!ips.length || ips.some((x) => isPrivateIp(x.address))) throw new Error('Địa chỉ nội bộ bị chặn');
  
  return u;
}

/** Nếu có đặt biến môi trường ACCESS_KEY thì bắt buộc client gửi đúng khóa. */
function authorized(provided) {
  const k = process.env.ACCESS_KEY;
  if (!k) return true;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(k);
  // Dùng timingSafeEqual chống tấn công dò mật khẩu qua thời gian phản hồi (Timing Attack)
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { UA, isPrivateIp, assertPublic, authorized };
