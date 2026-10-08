// Read-only infrastructure observations. No private source, user identifiers,
// model traces, recovery tokens or passwords belong in this response.
import {type Env,HttpError,json,coordinate} from './contracts';
import type {Identity} from './accounts';

export async function operations(env:Env,actor:Identity){
 if(actor.kind!=='operator')throw new HttpError(403,'infrastructure operator required');
 const observed=Date.now(),since=observed-86400000,stale=observed-90*60000;
 const statements=[
  env.DB.prepare('SELECT status,COUNT(*) AS count FROM experiments GROUP BY status'),
  env.DB.prepare('SELECT status,COUNT(*) AS count FROM observatory_trials WHERE created_at >= ? GROUP BY status').bind(since),
  env.DB.prepare('SELECT status,COUNT(*) AS count FROM native_verifications WHERE requested_at >= ? GROUP BY status').bind(since),
  env.DB.prepare("SELECT COUNT(*) AS count,AVG(updated_at-created_at) AS mean_duration_ms,MAX(updated_at-created_at) AS max_duration_ms FROM observatory_trials WHERE status = 'completed' AND updated_at >= ?").bind(since),
  env.DB.prepare("SELECT COUNT(*) AS count FROM observatory_trials WHERE status NOT IN ('completed','failed') AND created_at < ?").bind(stale),
  env.DB.prepare("SELECT COUNT(*) AS count FROM native_verifications WHERE status IN ('requested','running') AND requested_at < ?").bind(stale),
  env.DB.prepare("SELECT id,created_at,completed_at,object_count,byte_count,restore_status FROM workspace_backups WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1"),
  env.DB.prepare("SELECT id,completed_at AS backup_sealed_at FROM workspace_backups WHERE status = 'completed' AND restore_status = 'completed' ORDER BY completed_at DESC LIMIT 1"),
  env.DB.prepare('SELECT status,restore_status,COUNT(*) AS count FROM workspace_backups GROUP BY status,restore_status'),
  env.DB.prepare('SELECT status,COUNT(*) AS count FROM application_runs WHERE created_at >= ? GROUP BY status').bind(since),
  env.DB.prepare("SELECT COUNT(*) AS count FROM application_runs WHERE status IN ('requested','testing') AND created_at < ?").bind(stale),
 ];
 const results=await env.DB.batch<Record<string,string|number|null>>(statements),day=new Date(observed).toISOString().slice(0,10);
 const budgets=await coordinate(env,'OBSERVATORY-BUDGET-'+day,'operational-budgets');
 const latest=results[6]!.results[0]??null,restored=results[7]!.results[0]??null;
 const alerts=[];
 if(!restored||observed-Number(restored.backup_sealed_at)>36*3600000)alerts.push('no_recent_sealed_backup_with_completed_restore_drill');
 if(Number(results[4]!.results[0]?.count))alerts.push('trial_pending_over_90_minutes');
 if(Number(results[5]!.results[0]?.count))alerts.push('verification_pending_over_90_minutes');
 if(Number(results[10]!.results[0]?.count))alerts.push('application_pending_over_90_minutes');
 return json({schema_version:1,scope:'infrastructure_operator',observed_at:observed,window_start:since,
  metadata_source:'transactional_D1_mirrors_not_live_queue_depth',evaluator_binary_hash:env.NATIVE_VERIFIER_BINARY_HASH??null,
  applications_requested_last_24h:results[9]!.results,pending_applications_over_90m:Number(results[10]!.results[0]?.count??0),
  experiments:results[0]!.results,trials_accepted_last_24h:results[1]!.results,
  verification_workflows_requested_last_24h:results[2]!.results,
  completed_trial_duration_including_repairs:results[3]!.results[0],
  pending_trials_over_90m:Number(results[4]!.results[0]?.count??0),pending_verifications_over_90m:Number(results[5]!.results[0]?.count??0),
  backups:results[8]!.results,latest_completed_backup:latest,latest_completed_restore_drill:restored,
  observatory_budget:{day,...budgets as Record<string,number>},alerts,
  costs:null,cost_scope:'provider_billing_not_collected',qualification_scope:'workflow_completion_does_not_assert_candidate_correctness'},200);
}
