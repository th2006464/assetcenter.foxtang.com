fetch('/session',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(s=>{if(s?.authenticated)location.replace('/devices.html');}).catch(()=>{});
