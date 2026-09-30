document.getElementById('google-login').addEventListener('click',()=>location.assign('https://auth.foxtang.com/access/06fb92fada7e8c0c8c67ae86d672e10bd02f20e0434722db'));
fetch('/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>{if(s?.authenticated)location.replace('/devices.html');}).catch(()=>{});
