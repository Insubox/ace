// Read-only operational snapshot. Credentials stay in the Node client.
import assert from 'node:assert/strict';
import {settings,api} from '../cloud/scripts/client.mjs';
const response=await api(settings(),'/v1/operations'),snapshot=await response.json();
assert.equal(snapshot.schema_version,1);assert.equal(snapshot.scope,'infrastructure_operator');
assert.equal(snapshot.costs,null);
assert(Number.isFinite(snapshot.observed_at));
assert(Array.isArray(snapshot.alerts));
assert(snapshot.observatory_budget.containers_used<=snapshot.observatory_budget.containers_limit);
console.log(JSON.stringify(snapshot));
