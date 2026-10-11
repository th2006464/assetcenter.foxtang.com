import { createRemoteJWKSet, jwtVerify } from 'jose';
let cached;
export function accessToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  return request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] || '';
}
export async function verifyAccess(token, env, keys) {
  if (!token || token.length > 16384 || !env.ACCESS_AUD || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '')) return null;
  try {
    if (!keys) {
      if (cached?.domain !== env.ACCESS_TEAM_DOMAIN) cached = {domain:env.ACCESS_TEAM_DOMAIN, keys:createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`), {timeoutDuration:5000})};
      keys = cached.keys;
    }
    const {payload} = await jwtVerify(token, keys, {issuer:`https://${env.ACCESS_TEAM_DOMAIN}`, audience:env.ACCESS_AUD, algorithms:['RS256'], requiredClaims:['sub','exp','email','type']});
    if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(payload.email)) return null;
    const email=payload.email.trim().toLowerCase();
    const admins=(env.ADMIN_EMAILS || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
    const role=admins.includes(email)?'admin':'user';
    return {id:payload.sub, email, role, permissions:{import_assets:role==='admin',edit_records:role==='admin',delete_records:role==='admin'}};
  } catch { return null; }
}
