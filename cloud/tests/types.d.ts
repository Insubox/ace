import type { Env } from '../src/contracts';
declare global { namespace Cloudflare { interface Env extends importEnv {} } interface importEnv extends Env {} }
