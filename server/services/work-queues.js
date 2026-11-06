'use strict';
const w=require('./activity-workflow');
const LIMIT=6,LANES=['overdue','today','continuation'];
const titles={overdue:'Hilinenud tegevused',today:'Tänased tegevused',continuation:'Jätkamist ootavad kliendid'};
const empty=()=>Object.fromEntries(LANES.map(lane=>[lane,{ids:[],seen:[],batch:0}]));
const error=(status,message)=>{throw new w.WorkflowError(status,message);};
const key=id=>String(id);
function stateOf(row){
 if(!row)return empty();
 let state;try{state=JSON.parse(row.state);}catch{error(409,'Päevaplaani andmed vajavad kontrollimist.');}
 if(!state||LANES.some(lane=>!state[lane]||!Array.isArray(state[lane].ids)||!Array.isArray(state[lane].seen)||state[lane].ids.length>LIMIT||!Number.isSafeInteger(state[lane].batch)||state[lane].batch<0||[...state[lane].ids,...state[lane].seen].some(id=>!Number.isSafeInteger(id)||id<1)||new Set(state[lane].ids).size!==state[lane].ids.length||new Set(state[lane].seen).size!==state[lane].seen.length||state[lane].ids.some(id=>!state[lane].seen.includes(id))))error(409,'Päevaplaani andmed vajavad kontrollimist.');
 const all=LANES.flatMap(lane=>state[lane].seen);if(new Set(all).size!==all.length)error(409,'Päevaplaan sisaldab korduvaid tegevusi.');
 return state;
}
function date(day){if(!w.validDate(day))error(400,'Vigane tööpäev.');return day;}
async function pools(db,user,day,state){
 const admin=user.role==='admin';
 const continuation=new Set(state.continuation.seen.map(key));
 if(admin){
  const plans=await db('crm_work_queue_days').where({work_date:day}).select('state');
  for(const plan of plans)for(const id of stateOf(plan).continuation.seen)continuation.add(key(id));
 }
 const rows=await db('crm_activities as a').join('crm_clients as c','c.id','a.client_id').leftJoin('crm_activity_details as d','d.activity_id','a.id').leftJoin('users as u','u.id','a.owner_user_id')
  .where('a.status','active').where(q=>q.whereNull('c.stop_reason').orWhere('c.stop_reason',''))
  .modify(q=>{if(!admin)q.where('a.owner_user_id',user.id).where('c.owner_user_id',user.id);})
  .select('a.*','c.name as client','c.followup_count','u.name as owner_name','d.purpose','d.instructions','d.subject','d.template_id','d.next_step_json').orderBy('a.due_date').orderBy('a.id');
 const result={overdue:[],today:[],continuation:[]};
 for(const raw of rows){
  const a={...raw,due_date:w.dateOnly(raw.due_date),nextStep:w.parse(raw.next_step_json)};
  if(a.due_date<day)result.overdue.push(a);
  else if(a.due_date===day)result[continuation.has(key(a.id))?'continuation':'today'].push(a);
 }
 // A future or otherwise active task blocks another task for the same client.
 const candidates=await db('crm_clients as c').leftJoin('users as u','u.id','c.owner_user_id')
  .whereNotNull('c.owner_user_id').where(q=>q.whereNull('c.stop_reason').orWhere('c.stop_reason',''))
  .modify(q=>{if(!admin)q.where('c.owner_user_id',user.id);})
  .whereNotExists(db('crm_activities as active').select(db.raw('1')).whereRaw('active.client_id=c.id').where('active.status','active'))
  .whereNotExists(db('crm_email_inbox as reply').select(db.raw('1')).whereRaw('reply.client_id=c.id').whereNull('reply.handled_at'))
  .where(q=>q.where('c.followup_count','>',0)
   .orWhereExists(db('crm_activities as done').select(db.raw('1')).whereRaw('done.client_id=c.id').where('done.status','completed'))
   .orWhereExists(db('crm_imported_history as imported').select(db.raw('1')).whereRaw('imported.client_id=c.id')))
  .select('c.id','c.name','c.owner_user_id','c.followup_count','u.name as owner_name',db.raw("NULLIF(CAST(GREATEST(COALESCE((SELECT MAX(done.updated_at) FROM crm_activities done WHERE done.client_id=c.id AND done.status='completed'),'1000-01-01'),COALESCE((SELECT MAX(imported.activity_date) FROM crm_imported_history imported WHERE imported.client_id=c.id),'1000-01-01')) AS CHAR),'1000-01-01') AS last_contact"))
  .orderByRaw('last_contact IS NOT NULL ASC').orderBy('last_contact').orderBy('c.id');
 return {...result,candidates};
}
async function read(db,user,{day=w.today(),pages={}}={}){
 date(day);
 const admin=user.role==='admin';
 const plan=admin?null:await db('crm_work_queue_days').where({owner_user_id:user.id,work_date:day}).first();
 const state=stateOf(plan),available=await pools(db,user,day,state),queues={};
 for(const lane of LANES){
  const entries=available[lane],ids=new Set(state[lane].ids.map(key));
  const selected=entries.filter(a=>ids.has(key(a.id)));
  const preview=lane==='continuation'&&!state[lane].seen.length;
  const page=admin?Number(pages[lane]||0):0;
  if(!Number.isSafeInteger(page)||page<0||page>100000)error(400,'Vigane lehekülg.');
  const candidateTotal=lane==='continuation'?available.candidates.length:0;
  const total=entries.length+candidateTotal;
  const list=admin?(lane==='continuation'?[...entries,...available.candidates.map(c=>({...c,client_id:c.id,client:c.name,kind:'client'}))]:entries).slice(page*LIMIT,(page+1)*LIMIT):
   preview?available.candidates.slice(0,LIMIT).map(c=>({...c,client_id:c.id,client:c.name,kind:'client'})):selected;
  queues[lane]={title:titles[lane],items:list.map(a=>({...a,kind:a.kind||'activity'})),shown:list.length,total,waiting:Math.max(0,total-list.length),selected:state[lane].ids.length,batch:state[lane].batch,preview:!admin&&preview,page,has_next:admin&&(page+1)*LIMIT<total,
   can_next:!admin&&!!plan&&selected.length===0&&(lane==='continuation'?candidateTotal>0:entries.some(a=>!state[lane].seen.includes(Number(a.id))))};
 }
 return {work_date:day,limit:LIMIT,read_only:admin,initialized:!!plan,version:plan?.version??null,queues};
}
async function select(db,user,input={},day=w.today()){
 date(day);
 if(user.role==='admin')error(403,'Päevaplaani valimiseks lülitu tavakasutaja režiimi.');
 if(!['initialize','next'].includes(input.action)||Object.keys(input).some(k=>!['action','lane','version','work_date','template_id'].includes(k)))error(400,'Vigane päevaplaani toiming.');
 return db.transaction(async trx=>{
  const actor=await trx('users').where({id:user.id,is_active:1}).forUpdate().first('id','role');
  if(!actor)error(403,'Kasutaja pole aktiivne.');
  let plan=await trx('crm_work_queue_days').where({owner_user_id:user.id,work_date:day}).first();
  if(input.action==='initialize'){
   if(plan)return read(trx,user,{day});
   const state=empty(),available=await pools(trx,user,day,state);
   for(const lane of ['overdue','today'])state[lane].ids=state[lane].seen=available[lane].slice(0,LIMIT).map(a=>Number(a.id));
   await trx('crm_work_queue_days').insert({owner_user_id:user.id,work_date:day,version:1,state:JSON.stringify(state)});
   return read(trx,user,{day});
  }
  if(!plan||input.work_date!==day||!Number.isSafeInteger(input.version)||input.version!==plan.version)error(409,'Päevaplaan muutus. Värskenda töölauda.');
  if(!LANES.includes(input.lane))error(400,'Vigane tööjärjekord.');
  const state=stateOf(plan),lane=input.lane,available=await pools(trx,user,day,state);
  if(available[lane].some(a=>state[lane].ids.includes(Number(a.id))))error(409,'Tee praeguse valiku tegevused enne ära või lükka need edasi.');
  const ids=[];
  if(lane==='continuation'){
   const templateId=Number(input.template_id);
   if(!Number.isSafeInteger(templateId)||templateId<1)error(400,'Vali olemasolev tegevusmall.');
   const template=await trx('crm_templates').where({id:templateId,is_active:1}).first();
   if(!template||!w.TYPES.includes(template.type))error(400,'Vali olemasolev tegevusmall.');
   for(const candidate of available.candidates){
    await w.lockClient(trx,candidate.id,user);
    // Locking reads see work committed while this transaction waited for the client.
    if(await trx('crm_activities').where({client_id:candidate.id,status:'active'}).forUpdate().first('id'))continue;
    if(await trx('crm_email_inbox').where({client_id:candidate.id}).whereNull('handled_at').forUpdate().first('id'))continue;
    const created=await w.create(trx,user,{client_id:Number(candidate.id),type:template.type,template_id:template.id,purpose:template.purpose||template.name,instructions:template.body||'',subject:template.subject||'',due_date:day});
    ids.push(Number(created.id));if(ids.length===LIMIT)break;
   }
  }else ids.push(...available[lane].filter(a=>!state[lane].seen.includes(Number(a.id))).slice(0,LIMIT).map(a=>Number(a.id)));
  if(!ids.length)error(409,'Sobivaid tegevusi ei ole enam järjekorras. Värskenda töölauda.');
  state[lane]={ids,seen:[...state[lane].seen,...ids],batch:state[lane].batch+1};
  const encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>60000)error(409,'Päevaplaani maht on täis. Jätka kliendikaardilt.');
  await trx('crm_work_queue_days').where({id:plan.id}).update({state:encoded,version:plan.version+1,updated_at:trx.fn.now()});
  return read(trx,user,{day});
 });
}
module.exports={read,select,stateOf,LIMIT,LANES};
