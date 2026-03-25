# Verification: H111
**Status:** NOT_FIXED
**Evidence:** `scripts/crank/crank-provider.ts` line 35: `process.env.CLUSTER_URL || "http://localhost:8899"`. Multiple deploy scripts also fallback to localhost:8899. Production environments must set CLUSTER_URL — no code guard rejects localhost in production mode.
