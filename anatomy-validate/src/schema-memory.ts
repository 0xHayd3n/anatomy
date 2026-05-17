// src/schema-memory.ts
// AJV registration for the memory schema track. Separate from schema.ts so
// memory schema bumps don't churn the main .anatomy schema track.

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import schema_memory_0_1 from "./schema-memory-0.1.json" with { type: "json" };
import schema_memory_0_2 from "./schema-memory-0.2.json" with { type: "json" };

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

export const supportedMemoryVersions = ["0.1", "0.2"] as const;
export type SupportedMemoryVersion = (typeof supportedMemoryVersions)[number];

export const compiledMemorySchemas: Map<string, ValidateFunction> = new Map([
  ["0.1", ajv.compile(schema_memory_0_1)],
  ["0.2", ajv.compile(schema_memory_0_2)],
]);
