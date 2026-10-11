import {auditStatement,auditGroups,snapshotCondition} from './audit.js';
const columns = ['serial_number','device_name','asset_note','status','asset_group','sunlogin_code','sunlogin_version','deployment_source','system_version','mac_address','internal_ip','last_login_ip','last_online_time','computer_name','processor','memory','import_time'];
export async function importAssets(request, env, actor) {
  const headers={'Cache-Control':'no-store'};
  try {
    const text=await request.text();
    if(text.length>2_000_000)return Response.json({error:'导入文件过大'}, {status:413,headers});
    let body;try{body=JSON.parse(text);}catch{return Response.json({error:'无效 JSON'}, {status:400,headers});}
    if(!Array.isArray(body?.devices)||body.devices.length>5000)return Response.json({error:'设备列表无效，最多导入 5000 条'}, {status:400,headers});
    const records=new Map();let skipped=0;
    for(const input of body.devices){
      if(!input||typeof input!=='object'||Array.isArray(input))return Response.json({error:'设备记录无效'}, {status:400,headers});
      const sn=String(input.serial_number||'').trim().toUpperCase();
      if(!sn){skipped++;continue;}
      if(sn.length>256)return Response.json({error:'序列号过长'}, {status:400,headers});
      const record={...input,serial_number:sn,import_time:new Date().toISOString()};
      for(const key of columns){
        if(record[key]!=null&&typeof record[key]!=='string')return Response.json({error:'字段格式无效：'+key}, {status:400,headers});
        if(record[key]?.length>10000)return Response.json({error:'字段过长：'+key}, {status:400,headers});
      }
      records.set(sn,record);
    }
    const previous=new Map(),serials=[...records.keys()];
    for(let offset=0;offset<serials.length;offset+=100){
      const chunk=serials.slice(offset,offset+100);
      const result=await env.DB.prepare(`SELECT * FROM asset_inventory WHERE serial_number IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all();
      for(const row of result.results)previous.set(row.serial_number,row);
    }
    const entries=[...records.values()].map(record=>({
      ref:{source:'asset',serial_number:record.serial_number,computer_name:record.computer_name||null},
      before:previous.get(record.serial_number)||null,
      after:Object.fromEntries(columns.map(key=>[key,record[key]||null]))
    }));
    const groups=auditGroups(entries);
    if(groups.length){
      const id=crypto.randomUUID(),conditions=groups.map(group=>snapshotCondition('asset_inventory',columns,group));
      const statements=[auditStatement(env.DB,actor,'import',groups[0],{id,condition:conditions.map(item=>item.sql).join(' AND '),bindings:conditions.map(item=>item.value)})];
      for(const group of groups){
        if(group!==groups[0])statements.push(auditStatement(env.DB,actor,'import',group,{condition:'EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)',bindings:[id]}));
        statements.push(env.DB.prepare(`INSERT INTO asset_inventory (${columns.join(',')}) SELECT ${columns.map(key=>`json_extract(record.value,'$.${key}')`).join(',')} FROM json_each(?) record WHERE EXISTS (SELECT 1 FROM admin_audit WHERE id = ?) ON CONFLICT(serial_number) DO UPDATE SET ${columns.slice(1).map(key=>`${key}=excluded.${key}`).join(',')}`).bind(JSON.stringify(group.map(entry=>entry.after)),id));
      }
      const result=await env.DB.batch(statements);
      if(result[0].meta.changes!==1)return Response.json({error:'资产数据已变化，请重新导入'}, {status:409,headers});
    }
    return Response.json({success:true,received:body.devices.length,imported:records.size,skipped},{headers});
  }catch(error){if(error instanceof RangeError)return Response.json({error:error.message},{status:413,headers});console.error('Asset import failed',error);return Response.json({error:'数据库写入失败，请稍后重试'}, {status:500,headers});}
}
