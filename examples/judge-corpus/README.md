# Diverse GCD corpus

This is a fixed, reviewed corpus of 24 candidate programs and one reference.
It includes remainder, binary, recursive, subtraction, divisor-search and
factorization implementations, boundary mistakes, and resource exhaustion.
The neutral candidate IDs carry no outcome label. `manifest.json` fixes eight
holdout candidates and sixteen development candidates before evaluation.
The holdout is handcrafted and shares algorithm families with development;
it does not establish statistical generalization or independence from model
training data. Default judge thresholds remain unchanged for both subsets.

Build with the pinned toolchain:

```sh
node examples/judge-corpus/build.mjs
ace cloud prepare examples/judge-corpus --output /tmp/ace-diverse-plan
node cloud/scripts/judge-plan-contexts.mjs /tmp/ace-diverse-plan \
  examples/judge-corpus/.ace-build/build-manifest.json /tmp/ace-diverse-contexts
ace run examples/judge-corpus --output /tmp/ace-diverse-local --jobs 4
node examples/judge-corpus/check-run.mjs /tmp/ace-diverse-local
```

The build rejects duplicate optimized module hashes. Its manifest records
source hashes, compiler version and flags. This is reproducible build metadata,
not an independently attested source-to-WASM provenance chain.
The frozen model contexts contain source, public contract and neutral identities;
they contain no corpus family, split, oracle seed, test cases, execution outcome
or known failures. Freeze them before executing the experiment.

For a registered distributed experiment, use the existing submit/download
clients and then:

```sh
NODE_USE_ENV_PROXY=1 node cloud/scripts/judge-batch.mjs \
  /tmp/ace-diverse-contexts /tmp/ace-diverse-judgements
node cloud/scripts/judge-compare.mjs /tmp/ace-diverse-verified-run \
  /tmp/ace-diverse-comparison /tmp/ace-diverse-judgements/C-*
```

The batch requests both models for each candidate, at most 50 requests, to
retain matched second opinions for analysis. It resumes complete verified
records and uses the server's retained cache for interrupted downloads.
Comparison totals include only the second opinions the routing policy actually
reaches. Transport errors stop the batch; retained provider faults stay faults.
All candidates still execute. The comparison is an offline policy replay and
does not measure savings from filtering, causal ROI or time to Champion.
