/* Administrator controls consume server-verified session identity. */
let adminBusy=false;
const ADMIN_FIELD_LABELS={windows_user:'当前用户',outlook_account:'Outlook 邮箱',manufacturer:'厂商',model:'型号',os_name:'操作系统',forticlient_user:'VPN 用户',forticlient_version:'VPN 版本',forticlient_last_seen:'VPN 最后活动',c_drive_total_gb:'C 盘总容量（GB）',c_drive_free_gb:'C 盘剩余容量（GB）',report_time:'最后上报时间',script_version:'脚本版本',device_name:'向日葵设备名称',asset_note:'备注',status:'向日葵状态',asset_group:'向日葵分组',sunlogin_code:'向日葵识别码',sunlogin_version:'向日葵版本',deployment_source:'部署来源',system_version:'资产系统版本',mac_address:'MAC 地址',internal_ip:'内网 IP',last_login_ip:'最后登录 IP',last_online_time:'最后在线时间',processor:'处理器',memory:'内存',import_time:'导入时间'};
function isAdministrator(){return sessionUser?.role==='admin';}
function syncAdminControls(){
  const admin=isAdministrator();
  const button=$('importSunBtn');if(button)button.hidden=!admin;
  const identity=$('sessionIdentity');
  if(identity){identity.hidden=!admin;identity.textContent=admin?'管理员 · '+sessionUser.email:'';}
}
function recordActions(row,index){
  if(!isAdministrator()||!Array.isArray(row.record_refs)||!row.record_refs.length)return '';
  return `<div class="record-actions"><button class="btn btn-sm" type="button" data-record-action="edit" data-record-index="${index}">编辑</button><button class="btn btn-sm btn-danger" type="button" data-record-action="delete" data-record-index="${index}">删除</button></div>`;
}
async function managementRequest(path,method,body){
  const response=await authenticatedFetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===403){sessionUser=null;syncAdminControls();render();}
    throw new Error(data.error||`操作失败 · HTTP ${response.status}`);
  }
  return data;
}
function recordSummary(refs){
  return refs.map(ref=>`<li>${ref.source==='agent'?'Agent 上报':'向日葵资产'}：<strong>${escapeHtml(ref.computer_name||'—')}</strong> · <span class="mono">${escapeHtml(ref.serial_number)}</span></li>`).join('');
}
async function deleteRecord(row){
  const refs=row.record_refs;
  const confirmed=await openModal({title:'删除历史设备记录',body:`<p>将删除以下 ${refs.length} 条原始记录：</p><ul class="record-summary">${recordSummary(refs)}</ul><p class="modal-hint">删除后，设备再次上报或重新导入时会重新出现。</p>`,confirmText:'确认删除',cancelText:'取消'});
  if(!confirmed)return;
  await managementRequest('/api/admin/records','DELETE',{refs});
  await loadDevices();
  showSunError('历史记录已删除');
}
function editorFields(records){
  return records.map((record,index)=>`<fieldset class="record-fieldset"><legend>${record.source==='agent'?'Agent 上报信息':'向日葵资产信息'}</legend><div class="editor-grid">`
    +`<label class="modal-field"><span class="modal-field-label">序列号（不可修改）</span><input class="modal-input" readonly value="${escapeHtml(record.serial_number)}"></label>`
    +`<label class="modal-field"><span class="modal-field-label">计算机名（不可修改）</span><input class="modal-input" readonly value="${escapeHtml(record.computer_name||'')}"></label>`
    +Object.entries(record.fields).map(([key,value])=>{
      const numeric=key==='c_drive_total_gb'||key==='c_drive_free_gb';
      const required=key==='report_time'||key==='script_version';
      const attributes=`data-source-index="${index}" data-field="${escapeHtml(key)}"`;
      return `<label class="modal-field"><span class="modal-field-label">${escapeHtml(ADMIN_FIELD_LABELS[key]||key)}</span>`
        +(key==='asset_note'?`<textarea class="modal-input editor-note" ${attributes} maxlength="10000">${escapeHtml(value)}</textarea>`:`<input class="modal-input" ${attributes} type="${numeric?'number':'text'}" ${numeric?'min="0" step="any"':'maxlength="10000"'} ${required?'required':''} value="${escapeHtml(value)}">`)+`</label>`;
    }).join('')+'</div></fieldset>').join('');
}
function collectRecordChanges(records,inputs,originalInputs){
  const fields=records.map(()=>({}));
  inputs.forEach(input=>{
    if(input.value===originalInputs.get(input))return;
    const index=Number(input.dataset.sourceIndex),key=input.dataset.field;
    const previous=records[index].fields[key],numeric=key==='c_drive_total_gb'||key==='c_drive_free_gb';
    const value=input.value===''?null:numeric?Number(input.value):input.value;
    if(value!==previous)fields[index][key]=value;
  });
  return records.map((record,index)=>({source:record.source,serial_number:record.serial_number,fields:fields[index]})).filter(change=>Object.keys(change.fields).length);
}
async function editRecord(row){
  const {records}=await managementRequest('/api/admin/records/detail','POST',{refs:row.record_refs});
  closeModal();
  const previousFocus=document.activeElement;
  const mask=document.createElement('div');mask.id='modalMask';mask.className='modal-mask';
  mask.innerHTML=`<form class="modal admin-editor" role="dialog" aria-modal="true" aria-labelledby="editorTitle"><h2 class="modal-title" id="editorTitle">编辑设备信息</h2><p class="modal-hint">序列号和计算机名不可修改。其他信息可能被下一次上报或导入覆盖。</p><div class="editor-fields">${editorFields(records)}</div><p class="editor-error" role="alert" hidden></p><div class="modal-actions"><button class="btn btn-sm" type="button" data-editor-cancel>取消</button><button class="btn btn-sm btn-primary" type="submit">保存修改</button></div></form>`;
  document.body.appendChild(mask);
  const form=mask.querySelector('form'),error=mask.querySelector('.editor-error');
  const originalInputs=new Map(Array.from(form.querySelectorAll('[data-field]'),input=>[input,input.value]));
  let saving=false;
  const close=()=>{closeModal();previousFocus?.focus();};
  const completed=new Promise(resolve=>{
    mask.querySelector('[data-editor-cancel]').addEventListener('click',()=>{if(!saving){close();resolve();}});
    mask.addEventListener('click',event=>{if(event.target===mask&&!saving){close();resolve();}});
    mask.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();if(!saving){close();resolve();}}
      if(event.key==='Tab'){
        const focusable=Array.from(form.querySelectorAll('input,textarea,button')).filter(el=>!el.disabled);
        const first=focusable[0],last=focusable.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(saving)return;
      const changes=collectRecordChanges(records,form.querySelectorAll('[data-field]'),originalInputs);
      if(!changes.length){close();resolve();return;}
      saving=true;error.hidden=true;
      form.querySelectorAll('button').forEach(button=>button.disabled=true);
      try{
        await managementRequest('/api/admin/records','PATCH',{refs:row.record_refs,changes});
        close();await loadDevices();showSunError('设备信息已更新');resolve();
      }catch(cause){error.textContent=cause.message;error.hidden=false;}
      finally{saving=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);}
    });
  });
  form.querySelector('[data-field]')?.focus();
  await completed;
}
async function handleRecordAction(event){
  const button=event.target.closest('[data-record-action]');
  if(!button||!isAdministrator()||adminBusy||importBusy)return;
  const row=allDevices[Number(button.dataset.recordIndex)];if(!row?.record_refs?.length)return;
  adminBusy=true;button.disabled=true;
  try{if(button.dataset.recordAction==='edit')await editRecord(row);else if(button.dataset.recordAction==='delete')await deleteRecord(row);}
  catch(error){showSunError(error.message);}
  finally{adminBusy=false;button.disabled=false;}
}
