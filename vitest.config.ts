import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
  plugins: [{name:'ace-html-text',enforce:'pre',transform(source,id){if(id.endsWith('.html'))return `export default ${JSON.stringify(source)};`;}},cloudflareTest({
    main: './cloud/src/worker.ts',
    miniflare: {
      compatibilityDate: '2026-10-05', compatibilityFlags: ['nodejs_compat'],
      bindings: { NATIVE_VERIFIER_BINARY_HASH:'f'.repeat(64), API_TOKEN: 'local-tests-only-0123456789abcdef0123456789abcdef' },
      durableObjects: { COORDINATORS: { className: 'ExperimentCoordinator', useSQLite: true } },
      d1Databases: ['DB'], r2Buckets: ['ARTIFACTS'],
      queueProducers: { EVALUATIONS: 'ace-evaluations', FINALIZATIONS: 'ace-finalizations' },
      workflows: { NATIVE_VERIFICATIONS:{name:'ace-native-verifications',className:'NativeVerificationWorkflow'}, EXPERIMENTS: { name: 'ace-experiments', className: 'ExperimentWorkflow' } }
    }
  })],
  test: { include: ['cloud/tests/**/*.test.ts'], testTimeout: 30_000 }
});
