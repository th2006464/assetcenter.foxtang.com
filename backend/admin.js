import {accessToken,verifyAccess} from './access.js';
import {auditGroups,auditStatement,snapshotCondition} from './audit.js';
const sources={
  agent:{table:'devices',fields:['windows_user','outlook_account','manufacturer','model','os_name','forticlient_user','forticlient_last_seen','forticlient_version','c_drive_total_gb','c_drive_free_gb','report_time','script_version']},
  asset:{table:'asset_inventory',fields:['device_name','asset_note','status','asset_group','sunlogin_code','sunlogin_version','deployment_source','system_version','mac_address','internal_ip','last_login_ip','last_online_time','processor','memory','import_time']}
};
const reply=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store'}});
const key=ref=>JSON.stringify([ref.source,ref.serial_number]);
function parseRefs(input){
  if(!Array.isArray(input)||!input.length||input.length>20)throw new Error('数据来源无效，请刷新列表');
  const unique=new Set();
  return input.map(ref=>{
    if(!ref||!Object.hasOwn(sources,ref.source)||typeof ref.serial_number!=='string'||!ref.serial_number||ref.serial_number.length>256||!(ref.computer_name===null||typeof ref.computer_name==='string')||ref.computer_name?.length>1000)throw new Error('记录标识无效');
    if(unique.has(key(ref)))throw new Error('记录标识重复');
    unique.add(key(ref));return {source:ref.source,serial_number:ref.serial_number,computer_name:ref.computer_name};
  });
}
function validateChanges(input,refs,rows){
  if(!Array.isArray(input)||!input.length||input.length>refs.length)throw new Error('没有可保存的修改');
  const seen=new Set();
  return input.map(change=>{
    const index=refs.findIndex(ref=>key(ref)===key(change));
    if(index<0||seen.has(key(change)))throw new Error('修改的数据来源无效');
    seen.add(key(change));
    const config=sources[change.source],fields=change.fields;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!Object.keys(fields).length)throw new Error('修改字段无效');
    for(const [name,value] of Object.entries(fields)){
      if(!config.fields.includes(name))throw new Error('字段不可编辑：'+name);
      if(name==='c_drive_total_gb'||name==='c_drive_free_gb'){
        if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0))throw new Error('磁盘容量必须是非负数字或空值');
      }else if(value!==null&&(typeof value!=='string'||value.length>10000))throw new Error('字段内容无效：'+name);
      if(['report_time','script_version'].includes(name)&&(typeof value!=='string'||!value.trim()))throw new Error('字段不能为空：'+name);
      if(['report_time','forticlient_last_seen','last_online_time','import_time'].includes(name)&&value&&!Number.isFinite(Date.parse(value)))throw new Error('时间格式无效：'+name);
    }
    const after={...rows[index],...fields};
    if(change.source==='agent'&&after.c_drive_total_gb!=null&&after.c_drive_free_gb!=null&&after.c_drive_free_gb>after.c_drive_total_gb)throw new Error('剩余容量不能超过总容量');
    return {ref:refs[index],fields,index};
  });
}
export async function manageRecords(request,env){
  const user=await verifyAccess(accessToken(request),env);
  if(!user)return reply('Unauthorized',401);
  if(user.role!=='admin')return reply('需要管理员权限',403);
  const detail=new URL(request.url).pathname==='/admin/records/detail';
  if(detail?request.method!=='POST':!['PATCH','DELETE'].includes(request.method))return reply('Method Not Allowed',405);
  try{
    const text=await request.text();if(text.length>200000)return reply('请求内容过大',413);
    let refs,body;
    try{body=JSON.parse(text);refs=parseRefs(body?.refs);}catch(error){return reply(error instanceof SyntaxError?'无效 JSON':error.message,400);}
    const rows=[];
    for(const ref of refs){
      const row=await env.DB.prepare(`SELECT * FROM ${sources[ref.source].table} WHERE serial_number = ? AND computer_name IS ?`).bind(ref.serial_number,ref.computer_name).first();
      if(!row)return reply('记录已变化或已删除，请刷新列表后重试',409);
      rows.push(row);
    }
    if(detail)return Response.json({records:refs.map((ref,index)=>({...ref,fields:Object.fromEntries(sources[ref.source].fields.map(field=>[field,rows[index][field]??null]))}))},{headers:{'Cache-Control':'no-store'}});
    let changes=[];
    if(request.method==='PATCH'){
      try{changes=validateChanges(body.changes,refs,rows);}catch(error){return reply(error.message,400);}
    }
    const id=crypto.randomUUID(),after=rows.map(row=>({...row}));
    for(const change of changes)Object.assign(after[change.index],change.fields);
    const action=request.method==='DELETE'?'delete':'edit';
    const groups=auditGroups(refs.map((ref,index)=>({ref,before:rows[index],after:action==='delete'?null:after[index]})));
    const conditions=[];
    for(const group of groups){
      for(const source of ['agent','asset']){
        const entries=group.filter(entry=>entry.ref.source===source);if(!entries.length)continue;
        conditions.push(snapshotCondition(sources[source].table,['serial_number','computer_name',...sources[source].fields],entries));
      }
    }
    // Audit gate and all mutations share one transaction. Stale snapshots make
    // the whole batch a no-op, preventing partial changes and misleading logs.
    const statements=[auditStatement(env.DB,user.email,action,groups[0],{id,condition:conditions.map(item=>item.sql).join(' AND '),bindings:conditions.map(item=>item.value)})];
    for(const group of groups.slice(1))statements.push(auditStatement(env.DB,user.email,action,group,{condition:'EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)',bindings:[id]}));
    if(action==='delete'){
      for(const ref of refs)statements.push(env.DB.prepare(`DELETE FROM ${sources[ref.source].table} WHERE serial_number = ? AND computer_name IS ? AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)`).bind(ref.serial_number,ref.computer_name,id));
    }else{
      for(const {ref,fields} of changes){
        const names=Object.keys(fields);
        statements.push(env.DB.prepare(`UPDATE ${sources[ref.source].table} SET ${names.map(name=>`${name} = ?`).join(',')} WHERE serial_number = ? AND computer_name IS ? AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)`).bind(...names.map(name=>fields[name]),ref.serial_number,ref.computer_name,id));
      }
    }
    const result=await env.DB.batch(statements);
    if(result[0].meta.changes!==1)return reply('记录已变化，请刷新列表后重试',409);
    return Response.json({success:true,affected:action==='delete'?refs.length:changes.length},{headers:{'Cache-Control':'no-store'}});
  }catch(error){if(error instanceof RangeError)return reply(error.message,413);console.error('Record management failed',error);return reply('数据库操作失败，请稍后重试',500);}
}
