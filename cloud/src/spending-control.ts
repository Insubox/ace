import {z} from 'zod';
import {type Env,coordinate,HttpError,json,strictJson} from './contracts';
import type {Identity} from './accounts';

// This is admission control for ACE, not a Cloudflare invoice cap. Amounts
// are integer USD cents. Allowances are conservative planning estimates,
// not provider price guarantees, and are never refunded after a failure.
export const CUTOFF_CENTS=17500;
export const SNAPSHOT_MAX_AGE_MS=24*3600000;
const NAME='ACE-ACCOUNT-SPENDING';
const allowances={ai:100,container:500} as const;
type Snapshot={period_start:number;period_end:number;observed_at:number;total_cents:number};
type State={revision:number;snapshot:Snapshot|null;reserved_cents:number;paused:boolean;updates:{revision:number;at:number;action:string}[]};
const initial=():State=>({revision:0,snapshot:null,reserved_cents:0,paused:false,updates:[]});
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const updateSchema=z.strictObject({revision:integer,period_start:integer,period_end:integer,observed_at:integer,total_cents:integer,resume:z.boolean().default(false)});
function status(state:State,now:number){
 const s=state.snapshot;
 const reason=state.paused?'operator_paused':!s?'billing_snapshot_missing':now<s.period_start||now>=s.period_end?'billing_period_expired':now<s.observed_at||now-s.observed_at>=SNAPSHOT_MAX_AGE_MS?'billing_snapshot_stale':s.total_cents+state.reserved_cents+allowances.ai>=CUTOFF_CENTS?'budget_margin_reached':null;
 const headroom=s?CUTOFF_CENTS-s.total_cents-state.reserved_cents:0;
 return{schema_version:1,enforced:true,paused:reason!==null,reason,ai_allowed:reason===null&&headroom>allowances.ai,containers_allowed:reason===null&&headroom>allowances.container,cutoff_cents:CUTOFF_CENTS,currency:'USD',revision:state.revision,snapshot:s,reserved_cents:state.reserved_cents,planning_allowances_cents:allowances,snapshot_max_age_ms:SNAPSHOT_MAX_AGE_MS,scope:'ACE AI and container starts only; estimates plus operator-verified account spend. Not an account invoice cap.'};
}
export async function spendingOperation(tx:DurableObjectTransaction,op:string,body:Record<string,unknown>){
 const state=await tx.get<State>('spending-control')??initial(),now=Date.now();
 if(op==='spending-status')return status(state,now);
 if(op==='spending-update'){
  const input=updateSchema.parse(body);
  if(input.revision!==state.revision)throw new HttpError(409,'spending control revision changed; read current status');
  if(input.period_start>now||input.period_end<=now||input.period_end-input.period_start>40*86400000||input.observed_at>now||input.observed_at<input.period_start||now-input.observed_at>=SNAPSHOT_MAX_AGE_MS)throw new HttpError(400,'a recent observation within the current billing period is required');
  const previous=state.snapshot;
  if(previous){
   if(input.period_start===previous.period_start&&input.period_end===previous.period_end){
    if(input.total_cents<previous.total_cents||input.observed_at<previous.observed_at)throw new HttpError(409,'account spend and observation time cannot decrease within a billing period');
   }else{
    if(now<previous.period_end||input.period_start<previous.period_end)throw new HttpError(409,'cannot reset reservations before the previous billing period ends');
    state.reserved_cents=0;
   }
  }
  state.snapshot={period_start:input.period_start,period_end:input.period_end,observed_at:input.observed_at,total_cents:input.total_cents};
  if(input.resume)state.paused=false;
 }else if(op==='spending-pause'){
  z.strictObject({revision:integer}).parse(body);
  if(body.revision!==state.revision)throw new HttpError(409,'spending control revision changed');
  state.paused=true;
 }else if(op==='spending-reserve'){
  const {kind}=z.strictObject({kind:z.enum(['ai','container'])}).parse(body),current=status(state,now);
  if(current.paused)throw new HttpError(429,'ACE paid tasks paused: '+current.reason+'. Source, history and reviews remain available.');
  // Serialize account-wide admission. A retry is a new possible charge.
  if(state.snapshot!.total_cents+state.reserved_cents+allowances[kind]>=CUTOFF_CENTS)throw new HttpError(429,'ACE paid tasks paused: budget margin would be exceeded.');
  state.reserved_cents+=allowances[kind];
 }else throw new HttpError(404,'unknown spending control operation');
 state.revision++;
 if(op!=='spending-reserve')state.updates=[...state.updates,{revision:state.revision,at:now,action:op}].slice(-32);
 await tx.put('spending-control',state);
 return status(state,now);
}
export async function spendingStatus(env:Env){
 if(env.SPENDING_CONTROL_MODE==='local-disabled')return{...status(initial(),Date.now()),enforced:false,paused:false,reason:null,ai_allowed:true,containers_allowed:true};
 return await coordinate(env,NAME,'spending-status') as ReturnType<typeof status>;
}
export async function requireSpendingAdmission(env:Env,kind:keyof typeof allowances='ai'){
 const current=await spendingStatus(env);
 if(current.paused)throw new HttpError(429,'ACE paid tasks paused: '+current.reason+'. Source, history and reviews remain available.');
 if(!(kind==='ai'?current.ai_allowed:current.containers_allowed))throw new HttpError(429,'ACE paid tasks paused: budget margin would be exceeded.');
}
export async function reservePaidStart(env:Env,kind:keyof typeof allowances){
 if(env.SPENDING_CONTROL_MODE==='local-disabled')return;
 await coordinate(env,NAME,'spending-reserve',{kind});
}
export async function readSpending(env:Env,actor:Identity){
 const current=await spendingStatus(env);
 // Do not expose account-wide billing amounts to project members.
 return json(actor.kind==='operator'?current:{schema_version:1,enforced:current.enforced,paused:current.paused,reason:current.reason,ai_allowed:current.ai_allowed,containers_allowed:current.containers_allowed});
}
export async function updateSpending(env:Env,actor:Identity,bytes:Uint8Array,pause=false){
 if(actor.kind!=='operator')throw new HttpError(403,'infrastructure operator required');
 const input=strictJson(new TextDecoder().decode(bytes)) as Record<string,unknown>;
 return json(await coordinate(env,NAME,pause?'spending-pause':'spending-update',input));
}
