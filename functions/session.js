import { accessToken, verifyAccess } from '../backend/access.js';
export async function onRequest({request,env}) {
  const headers={'Cache-Control':'no-store'};
  if(new URL(request.url).hostname !== 'assetcenter.foxtang.com')return new Response('Not Found',{status:404,headers});
  if(request.method !== 'GET')return new Response('Method Not Allowed',{status:405,headers});
  const user=await verifyAccess(accessToken(request),env);
  return Response.json({authenticated:Boolean(user),isAdmin:user?.email?.trim().toLowerCase()==='th2006464@gmail.com'}, {headers});
}
