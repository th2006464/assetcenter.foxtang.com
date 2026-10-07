import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
await rm('public',{recursive:true,force:true});await mkdir('public');
for(const file of ['index.html','devices.html','dashboard.html','compare.html','favicon.svg','css','js','cybersecurity.png','cybersecurity-440-q90.webp'])await cp(file,'public/'+file,{recursive:true});
await writeFile('public/_routes.json',JSON.stringify({version:1,include:['/api/*','/session','/auth/login','/devices','/devices/*','/devices.html','/dashboard','/dashboard/*','/dashboard.html','/compare','/compare/*','/compare.html'],exclude:[]}));
