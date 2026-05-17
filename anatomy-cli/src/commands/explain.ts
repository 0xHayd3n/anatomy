// src/commands/explain.ts
// `anatomy explain <code>` — print human-readable explanation of an
// error or warning code emitted by the validator.

import { explainCode, listAllCodes } from "../error-docs.js";

export function explainCommand(code: string | undefined): number {
  if (!code) {
    console.error("anatomy: explain requires a code argument. Available codes:");
    for (const c of listAllCodes()) console.error(`  ${c}`);
    return 2;
  }
  const doc = explainCode(code);
  if (!doc) {
    console.error(`anatomy: unknown code "${code}". Available codes:`);
    for (const c of listAllCodes()) console.error(`  ${c}`);
    return 2;
  }
  console.log(`${code}  [${doc.severity}]`);
  console.log(`  ${doc.summary}`);
  console.log("");
  for (const line of doc.body.split("\n")) console.log(`  ${line}`);
  return 0;
}
