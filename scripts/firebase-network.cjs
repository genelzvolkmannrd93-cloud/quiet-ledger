const { createRequire } = require("node:module");

// The Firebase CLI uses Undici with a 10-second connection timeout by default.
// Some Google API routes from this machine consistently need longer to connect.
// Resolve the exact Undici copy used by the active Firebase CLI and widen only
// the network timeouts for that CLI process.
const firebaseCliEntry = process.argv[1];

if (!firebaseCliEntry) {
  throw new Error("Firebase CLI entry point is unavailable.");
}

const firebaseRequire = createRequire(firebaseCliEntry);
const { Agent, setGlobalDispatcher } = firebaseRequire("undici");

setGlobalDispatcher(
  new Agent({
    connect: { timeout: 60_000 },
    headersTimeout: 120_000,
    bodyTimeout: 120_000,
  }),
);
