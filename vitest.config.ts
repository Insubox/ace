import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
  plugins: [{name:'ace-html-text',enforce:'pre',transform(source,id){if(id.endsWith('.html'))return `export default ${JSON.stringify(source)};`;}},cloudflareTest({
    main: './cloud/src/worker.ts',
    miniflare: {
      compatibilityDate: '2026-10-05', compatibilityFlags: ['nodejs_compat'],
      bindings: { NATIVE_VERIFIER_BINARY_HASH:'f'.repeat(64), API_TOKEN: 'local-tests-only-0123456789abcdef0123456789abcdef' },
      durableObjects: { RESTORE_COORDINATORS:{className:'RestoreCoordinator',useSQLite:true}, COORDINATORS: { className: 'ExperimentCoordinator', useSQLite: true } },
      d1Databases: ['DB','RESTORE_DB'], r2Buckets: ['ARTIFACTS','BACKUPS','RESTORE_STORAGE'],
      queueProducers: { EVALUATIONS: 'ace-evaluations', FINALIZATIONS: 'ace-finalizations' },
      workflows: { BACKUP_WORKFLOW:{name:'ace-backups',className:'BackupWorkflow'}, NATIVE_VERIFICATIONS:{name:'ace-native-verifications',className:'NativeVerificationWorkflow'}, EXPERIMENTS: { name: 'ace-experiments', className: 'ExperimentWorkflow' } }
    }
  })],
  test: { setupFiles:['cloud/tests/setup.ts'], include: ['cloud/tests/**/*.test.ts'], testTimeout: 30_000 }
});
