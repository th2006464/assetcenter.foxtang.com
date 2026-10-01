export function onRequest({request}) {
  if(new URL(request.url).hostname!=='assetcenter.foxtang.com')return new Response('Not Found',{status:404});
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405});
  return new Response(null,{status:302,headers:{Location:'https://auth.foxtang.com/access/06fb92fada7e8c0c8c67ae86d672e10bd02f20e0434722db','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
