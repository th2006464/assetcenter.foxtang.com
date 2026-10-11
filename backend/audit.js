const encoder=new TextEncoder();
// Leave headroom below D1's 2,000,000-byte row/string limit.
const AUDIT_BYTES=1_500_000;
export function auditGroups(entries){
  const groups=[];let group=[],bytes=0;
  for(const entry of entries){
    const size=encoder.encode(JSON.stringify(entry)).length+16;
    if(size>AUDIT_BYTES)throw new RangeError('单条记录的历史信息过大，无法安全保存操作日志');
    if(bytes+size>AUDIT_BYTES){groups.push(group);group=[];bytes=0;}
    group.push(entry);bytes+=size;
  }
  if(group.length)groups.push(group);
  if(groups.length>40)throw new RangeError('历史信息过多，请拆分后分批操作');
  return groups;
}
export function snapshotCondition(table,columns,entries){
  // Compare the complete original row inside the transaction. JSON parameters
  // keep parameter count bounded even for bulk imports.
  const expression=columns.map(column=>`WHEN '${column}' THEN current.${column}`).join(' ');
  return {
    sql:`NOT EXISTS (SELECT 1 FROM json_each(?) expected LEFT JOIN ${table} current ON current.serial_number=json_extract(expected.value,'$.serial_number') WHERE (json_type(expected.value,'$.before')='null' AND current.serial_number IS NOT NULL) OR (json_type(expected.value,'$.before')!='null' AND (current.serial_number IS NULL OR EXISTS (SELECT 1 FROM json_each(expected.value,'$.before') snapshot WHERE snapshot.value IS NOT CASE snapshot.key ${expression} END))))`,
    value:JSON.stringify(entries.map(entry=>({serial_number:entry.ref.serial_number,before:entry.before})))
  };
}
export function auditStatement(DB,actor,action,entries,options={}){
  const condition=options.condition||'1';
  return DB.prepare(`INSERT INTO admin_audit (id,actor_email,action,records_json,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${condition}`)
    .bind(options.id||crypto.randomUUID(),actor,action,JSON.stringify(entries.map(entry=>entry.ref)),JSON.stringify(entries.map(entry=>entry.before)),JSON.stringify(entries.map(entry=>entry.after)),new Date().toISOString(),...(options.bindings||[]));
}
