import { accessToken, verifyAccess } from '../../backend/access.js';
export async function onRequest({request, env}) {
  const url = new URL(request.url);
  const headers = {'Cache-Control':'no-store'};
  if (url.hostname !== 'assetcenter.foxtang.com') return new Response('Not Found',{status:404,headers});
  const token = accessToken(request);
  const user = await verifyAccess(token, env);
  if (!user) return Response.json({error:'Unauthorized'},{status:401,headers});
  if (url.pathname === '/api/session' && request.method === 'GET') return Response.json({user},{headers});
  if (url.pathname === '/api/auth/callback' && request.method === 'GET') return new Response(null,{status:302,headers:{...headers,Location:'/devices.html'}});
  const paths = {'/api/devices':['/devices','GET'], '/api/import-assets':['/import-assets','POST']};
  const route = paths[url.pathname];
  if (!route) return new Response('Not Found',{status:404,headers});
  if (request.method !== route[1]) return new Response('Method Not Allowed',{status:405,headers});
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return new Response('Forbidden',{status:403,headers});
  if (!env.AMS) return new Response('Service unavailable',{status:503,headers});
  const upstreamHeaders = new Headers({'Cf-Access-Jwt-Assertion':token});
  for (const name of ['Content-Type','X-Import-Key']) {const v=request.headers.get(name);if(v)upstreamHeaders.set(name,v);}
  const upstream = await env.AMS.fetch(new Request('https://ams.foxtang.com'+route[0], {method:request.method,headers:upstreamHeaders, ...(request.method==='POST'?{body:request.body,duplex:'half'}:{})}));
  const outHeaders = new Headers({'Cache-Control':'no-store','Content-Type':upstream.headers.get('Content-Type') || 'text/plain'});
  return new Response(upstream.body,{status:upstream.status,headers:outHeaders});
}
