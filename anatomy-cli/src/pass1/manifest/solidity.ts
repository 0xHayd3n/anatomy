// src/pass1/manifest/solidity.ts
// Detects Solidity smart-contract projects via foundry.toml (Foundry) or
// hardhat.config.{js,ts,cjs,mjs} (Hardhat) or brownie-config.yaml. Stack:
// "solidity". Form: smart contracts ARE the product — neither library nor
// service in the conventional web sense, but "library" is the closest
// existing slug (other contracts depend on yours like a library).

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DetectedManifest } from "../../types.js";

interface SolidityParsed {
  configKind: "foundry" | "hardhat" | "brownie";
}

const HARDHAT_CONFIGS = ["hardhat.config.js", "hardhat.config.ts", "hardhat.config.cjs", "hardhat.config.mjs"];

export function detectSolidity(repoRoot: string): DetectedManifest | null {
  if (existsSync(join(repoRoot, "foundry.toml"))) {
    return { kind: "solidity", path: join(repoRoot, "foundry.toml"), parsed: { configKind: "foundry" } satisfies SolidityParsed };
  }
  for (const name of HARDHAT_CONFIGS) {
    if (existsSync(join(repoRoot, name))) {
      return { kind: "solidity", path: join(repoRoot, name), parsed: { configKind: "hardhat" } satisfies SolidityParsed };
    }
  }
  if (existsSync(join(repoRoot, "brownie-config.yaml"))) {
    return { kind: "solidity", path: join(repoRoot, "brownie-config.yaml"), parsed: { configKind: "brownie" } satisfies SolidityParsed };
  }
  return null;
}

export function solidityFormSuffix(_parsed: unknown): "library" {
  // Solidity contract sets are conventionally consumed as libraries by
  // other contracts. Service/cli-tool slugs don't apply to on-chain code.
  return "library";
}
