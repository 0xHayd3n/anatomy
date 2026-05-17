// src/types.ts
// Re-exports the generated root type as the public name `AnatomyDoc`.
// json-schema-to-typescript names the root type from its compile() arg
// (we pass "Anatomy"), which then exports as `Anatomy`. We re-export
// under our public name to decouple the public API from generator naming.

export type { Anatomy as AnatomyDoc } from "./types.generated.js";
