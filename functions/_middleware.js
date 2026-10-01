import {accessToken,verifyAccess} from '../backend/access.js';
const privatePages=new Set(['/devices','/devices.html','/dashboard','/dashboard.html','/compare','/compare.html']);
export async function onRequest({request,env,next}) {
  const url=new URL(request.url);
  if(!privatePages.has(url.pathname.replace(/\/$/,'')))return next();
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(url.hostname!=='assetcenter.foxtang.com')return new Response('Not Found',{status:404,headers});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method Not Allowed',{status:405,headers});
  if(!await verifyAccess(accessToken(request),env))return new Response(null,{status:302,headers:{...headers,Location:'/?login=1'}});
  const response=await next();const out=new Response(response.body,response);for(const [name,value] of Object.entries(headers))out.headers.set(name,value);return out;
}
