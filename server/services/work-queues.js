'use strict';
const w=require('./activity-workflow');
const LIMIT=6,LANES=['overdue','today'];
const titles={overdue:'Hilinenud tegevused',today:'Tänased tegevused'};
const empty=()=>Object.fromEntries(LANES.map(lane=>[lane,{ids:[],seen:[],batch:0}]));
const error=(status,message)=>{throw new w.WorkflowError(status,message);};
const key=id=>String(id);
function stateOf(row){
 if(!row)return empty();
 let state;try{state=JSON.parse(row.state);}catch{error(409,'Päevaplaani andmed vajavad kontrollimist.');}
 if(!state||LANES.some(lane=>!state[lane]||!Array.isArray(state[lane].ids)||!Array.isArray(state[lane].seen)||state[lane].ids.length>LIMIT||!Number.isSafeInteger(state[lane].batch)||state[lane].batch<0||[...state[lane].ids,...state[lane].seen].some(id=>!Number.isSafeInteger(id)||id<1)||new Set(state[lane].ids).size!==state[lane].ids.length||new Set(state[lane].seen).size!==state[lane].seen.length||state[lane].ids.some(id=>!state[lane].seen.includes(id))))error(409,'Päevaplaani andmed vajavad kontrollimist.');
 const all=LANES.flatMap(lane=>state[lane].seen);if(new Set(all).size!==all.length)error(409,'Päevaplaan sisaldab korduvaid tegevusi.');
 if(state.template_id!=null&&(!Number.isSafeInteger(state.template_id)||state.template_id<1))error(409,'Päevaplaani vaikemall vajab kontrollimist.');
 if(state.daily_ready!=null&&typeof state.daily_ready!=='boolean')error(409,'Päevaplaani algseadistus vajab kontrollimist.');
 return state;
}
function date(day){if(!w.validDate(day))error(400,'Vigane tööpäev.');return day;}
async function pools(db,user,day){
 const admin=user.role==='admin';
 const rows=await db('crm_activities as a').join('crm_clients as c','c.id','a.client_id').leftJoin('crm_activity_details as d','d.activity_id','a.id').leftJoin('users as u','u.id','a.owner_user_id')
  .where('a.status','active').where(q=>q.whereNull('c.stop_reason').orWhere('c.stop_reason',''))
  .modify(q=>{if(!admin)q.where('a.owner_user_id',user.id).where('c.owner_user_id',user.id);})
  .select('a.*','c.name as client','c.followup_count','u.name as owner_name','d.purpose','d.instructions','d.subject','d.template_id','d.next_step_json').orderBy('a.due_date').orderBy('a.id');
 const result={overdue:[],today:[]};
 for(const raw of rows){
  const a={...raw,due_date:w.dateOnly(raw.due_date),nextStep:w.parse(raw.next_step_json)};
  if(a.due_date<day)result.overdue.push(a);
  else if(a.due_date===day)result.today.push(a);
 }
 // A future or otherwise active task blocks another task for the same client.
 const candidates=await db('crm_clients as c').leftJoin('users as u','u.id','c.owner_user_id')
  .whereNotNull('c.owner_user_id').where(q=>q.whereNull('c.stop_reason').orWhere('c.stop_reason',''))
  .modify(q=>{if(!admin)q.where('c.owner_user_id',user.id);})
  .whereNotExists(db('crm_activities as active').select(db.raw('1')).whereRaw('active.client_id=c.id').where('active.status','active'))
  .whereNotExists(db('crm_email_inbox as reply').select(db.raw('1')).whereRaw('reply.client_id=c.id').whereNull('reply.handled_at'))
  .where(q=>q.where('c.followup_count','>',0).orWhere('c.client_type','Lead')
   .orWhereExists(db('crm_activities as done').select(db.raw('1')).whereRaw('done.client_id=c.id').where('done.status','completed'))
   .orWhereExists(db('crm_imported_history as imported').select(db.raw('1')).whereRaw('imported.client_id=c.id')))
  .select('c.id','c.name','c.owner_user_id','c.followup_count','u.name as owner_name',db.raw("NULLIF(CAST(GREATEST(COALESCE((SELECT MAX(done.updated_at) FROM crm_activities done WHERE done.client_id=c.id AND done.status='completed'),'1000-01-01'),COALESCE((SELECT MAX(imported.activity_date) FROM crm_imported_history imported WHERE imported.client_id=c.id),'1000-01-01')) AS CHAR),'1000-01-01') AS last_contact"))
  .orderByRaw("(COALESCE(c.followup_count,0)>0 OR EXISTS(SELECT 1 FROM crm_activities prior WHERE prior.client_id=c.id AND prior.status='completed') OR EXISTS(SELECT 1 FROM crm_imported_history prior WHERE prior.client_id=c.id)) DESC")
  .orderByRaw('last_contact IS NOT NULL ASC').orderBy('last_contact').orderBy('c.id');
 return {...result,candidates};
}
async function dailyTemplate(trx,user,day,state) {
 let id=state.template_id;
 if(!id){
  const history=await trx('crm_work_queue_days').where({owner_user_id:user.id}).where('work_date','<',day).orderBy('work_date','desc').limit(90);
  for(const previous of history){
   const saved=stateOf(previous);
   if(saved.template_id){id=saved.template_id;break;}
   // Upgrade legacy selections without borrowing another user's default.
   if(saved.today.ids.length){
    const rows=await trx('crm_activities as a').leftJoin('crm_activity_details as d','d.activity_id','a.id')
     .whereIn('a.id',saved.today.ids).where('a.owner_user_id',user.id).whereNot('a.status','cancelled').whereNotNull('d.template_id').select('d.template_id');
    const ids=[...new Set(rows.map(r=>Number(r.template_id)))];
    if(ids.length>1)return null;
    if(ids.length===1&&Number.isSafeInteger(ids[0])&&ids[0]>0){id=ids[0];break;}
   }
  }
 }
 if(!id)return null;
 const template=await trx('crm_templates').where({id,is_active:1}).first();
 if(!template)return null;
 try{
  await w.planned(trx,{type:template.type,template_id:template.id,purpose:template.purpose||template.name,subject:template.subject||'',instructions:template.body||'',due_date:day});
  w.chain(template.next_step_json);
 }catch(e){if(e instanceof w.WorkflowError)return null;throw e;}
 return template;
}
async function fillCandidates(trx,user,day,candidates,template,slots){
 const ids=[];
 if(slots<=0)return ids;
 for(const candidate of candidates){
  const client=await w.lockClient(trx,candidate.id,user);
  if(client.stop_reason)continue;
  // Current reads also see work/replies committed while the client lock waited.
  if(await trx('crm_activities').where({client_id:candidate.id,status:'active'}).forUpdate().first('id'))continue;
  if(await trx('crm_email_inbox').where({client_id:candidate.id}).whereNull('handled_at').forUpdate().first('id'))continue;
  const created=await w.create(trx,user,{client_id:Number(candidate.id),type:template.type,template_id:template.id,purpose:template.purpose||template.name,instructions:template.body||'',subject:template.subject||'',due_date:day});
  ids.push(Number(created.id));if(ids.length===slots)break;
 }
 return ids;
}
async function read(db,user,{day=w.today(),pages={}}={}){
 date(day);
 const admin=user.role==='admin';
 const plan=admin?null:await db('crm_work_queue_days').where({owner_user_id:user.id,work_date:day}).first();
 const state=stateOf(plan),available=await pools(db,user,day),queues={};
 for(const lane of LANES){
  const entries=available[lane],ids=new Set(state[lane].ids.map(key));
  const selected=entries.filter(a=>ids.has(key(a.id)));
  const page=admin?Number(pages[lane]||0):0;
  if(!Number.isSafeInteger(page)||page<0||page>100000)error(400,'Vigane lehekülg.');
  const list=admin?entries.slice(page*LIMIT,(page+1)*LIMIT):selected;
  queues[lane]={title:titles[lane],items:list.map(a=>({...a,kind:'activity'})),shown:list.length,total:entries.length,waiting:Math.max(0,entries.length-list.length),selected:state[lane].ids.length,batch:state[lane].batch,page,has_next:admin&&(page+1)*LIMIT<entries.length,
   can_next:!admin&&!!plan&&selected.length===0&&entries.some(a=>!state[lane].seen.includes(Number(a.id)))};
 }
 const reset=queues.today.shown===0&&state.today.ids.length>0;
 const slots=reset?LIMIT:LIMIT-state.today.ids.length;
 const pending=available.today.some(a=>!state.today.seen.includes(Number(a.id)));
 const unplanned={total:available.candidates.length,slots,can_fill:!admin&&!!plan&&slots>0&&!pending&&available.candidates.length>0};
 const needsDailyFill=!admin&&(!state.daily_ready||(state.today.ids.length<LIMIT&&(pending||!!state.template_id&&available.candidates.length>0)));
 return {work_date:day,limit:LIMIT,read_only:admin,initialized:!!plan,daily_ready:!!state.daily_ready,needs_daily_fill:needsDailyFill,default_template_id:state.template_id||null,version:plan?.version??null,queues,unplanned,revenue_warnings:{available:false}};
}
async function selectOnce(db,user,input,day){
 date(day);
 if(user.role==='admin')error(403,'Päevaplaani valimiseks lülitu tavakasutaja režiimi.');
 if(!['initialize','next','fill'].includes(input.action)||Object.keys(input).some(k=>!['action','lane','version','work_date','template_id'].includes(k)))error(400,'Vigane päevaplaani toiming.');
 return db.transaction(async trx=>{
  const actor=await trx('users').where({id:user.id,is_active:1}).forUpdate().first('id','role');
  if(!actor)error(403,'Kasutaja pole aktiivne.');
  let plan=await trx('crm_work_queue_days').where({owner_user_id:user.id,work_date:day}).first();
  if(input.action==='initialize'){
   const state=stateOf(plan);
   const available=await pools(trx,user,day);
   const unused=LIMIT-state.today.ids.length;
   const additions=unused>0&&(available.today.some(a=>!state.today.seen.includes(Number(a.id)))||!!state.template_id&&available.candidates.length>0);
   if(state.daily_ready&&!additions)return read(trx,user,{day});
   if(!plan){
    for(const lane of LANES){state[lane].ids=available[lane].slice(0,LIMIT).map(a=>Number(a.id));state[lane].seen=[...state[lane].ids];}
   }else{
    // Upgrade today's saved plan without reopening already consumed slots.
    const dated=available.today.filter(a=>!state.today.seen.includes(Number(a.id))).slice(0,LIMIT-state.today.ids.length).map(a=>Number(a.id));
    state.today.ids.push(...dated);state.today.seen.push(...dated);
   }
   const template=await dailyTemplate(trx,user,day,state);
   if(template){
    state.template_id=Number(template.id);
    if(!available.today.some(a=>!state.today.seen.includes(Number(a.id)))){
     const ids=await fillCandidates(trx,user,day,available.candidates,template,LIMIT-state.today.ids.length);
     state.today.ids.push(...ids);state.today.seen.push(...ids);
    }
   }
   if(!template)delete state.template_id;
   state.daily_ready=true;
   const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>60000)error(409,'Päevaplaani maht on täis. Jätka kliendikaardilt.');
   if(plan)await trx('crm_work_queue_days').where({id:plan.id}).update({state:encoded,version:plan.version+1,updated_at:trx.fn.now()});
   else await trx('crm_work_queue_days').insert({owner_user_id:user.id,work_date:day,version:1,state:encoded});
   return read(trx,user,{day});
  }
  if(!plan||input.work_date!==day||!Number.isSafeInteger(input.version)||input.version!==plan.version)error(409,'Päevaplaan muutus. Värskenda töölauda.');
  if(!LANES.includes(input.lane))error(400,'Vigane tööjärjekord.');
  const state=stateOf(plan),lane=input.lane,available=await pools(trx,user,day);
  const filling=input.action==='fill';
  if(filling&&lane!=='today')error(400,'Kliente saab lisada ainult tänasesse plaani.');
  const currentActive=available[lane].some(a=>state[lane].ids.includes(Number(a.id)));
  if(!filling&&currentActive)error(409,'Tee praeguse valiku tegevused enne ära või lükka need edasi.');
  let slots=LIMIT;
  if(filling){
   if(available.today.some(a=>!state.today.seen.includes(Number(a.id))))error(409,'Võta esmalt järjekorras olevad kuupäevaga tegevused.');
   if(!currentActive&&state.today.ids.length){state.today.ids=[];state.today.batch++;}
   slots=LIMIT-state.today.ids.length;
   if(slots<=0)error(409,'Tänase valiku kuus kohta on juba kasutusel.');
  }
  const ids=[];
  if(filling){
   const templateId=Number(input.template_id);
   if(!Number.isSafeInteger(templateId)||templateId<1)error(400,'Vali olemasolev tegevusmall.');
   const template=await trx('crm_templates').where({id:templateId,is_active:1}).first();
   if(!template||!w.TYPES.includes(template.type))error(400,'Vali olemasolev tegevusmall.');
   ids.push(...await fillCandidates(trx,user,day,available.candidates,template,slots));
   state.template_id=Number(template.id);state.daily_ready=true;
  }else ids.push(...available[lane].filter(a=>!state[lane].seen.includes(Number(a.id))).slice(0,LIMIT).map(a=>Number(a.id)));
  if(!ids.length)error(409,'Sobivaid tegevusi ei ole enam järjekorras. Värskenda töölauda.');
  state[lane]={ids:filling?[...state[lane].ids,...ids]:ids,seen:[...state[lane].seen,...ids],batch:state[lane].batch+(filling?0:1)};
  const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>60000)error(409,'Päevaplaani maht on täis. Jätka kliendikaardilt.');
  await trx('crm_work_queue_days').where({id:plan.id}).update({state:encoded,version:plan.version+1,updated_at:trx.fn.now()});
  return read(trx,user,{day});
 });
}
async function select(db,user,input={},day=w.today()){
 // No external side effects occur inside these transactions. A deadlock rolls
 // back the entire batch, so retrying cannot send mail or duplicate a commit.
 for(let attempt=0;;attempt++){
  try{return await selectOnce(db,user,input,day);}
  catch(e){
   if(e.code!=='ER_LOCK_DEADLOCK'||attempt>=4)throw e;
   // Concurrent owners can contend on InnoDB index gaps. Do not retry in lockstep.
   await new Promise(resolve=>setTimeout(resolve,Math.min(200,20*2**attempt)+Math.floor(Math.random()*20)));
  }
 }
}
module.exports={read,select,stateOf,LIMIT,LANES};
