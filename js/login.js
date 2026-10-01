if(new URLSearchParams(location.search).get('login')!=='1'){
fetch('/session',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null).then(s=>{if(s?.authenticated)location.replace('/devices.html');}).catch(()=>{});

}
