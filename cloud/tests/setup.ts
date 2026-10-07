import {beforeAll} from 'vitest';
import {env} from 'cloudflare:test';
import accounts from '../migrations/0004_native_accounts.sql?raw';
import stores from '../migrations/0003_native_stores.sql?raw';
import initial from '../migrations/0001_control_plane.sql?raw';
import recovery from '../migrations/0007_account_recovery.sql?raw';
import permissions from '../migrations/0006_project_permissions.sql?raw';
beforeAll(async()=>{for(const raw of[initial,stores,accounts,permissions,recovery])await env.DB.batch(raw.split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s)));});
