// src/schema.ts
// AJV configured for the Anatomy schema. strict:false rather than strict:true
// because the schema uses patterns AJV strict mode flags as false positives:
//   - propertyNames.pattern + additionalProperties:<subschema> in [operation.commands]
//     and [operation.conventions] (AJV can't statically prove key/value coverage)
//   - anyOf/oneOf required clauses in [environment]/[interface] that reference
//     properties defined on the parent schema (AJV's strictRequired flags these)
// strict:"log" would route these known-false-positive warnings to console.warn on
// every process startup; strict:false suppresses them without affecting validation.
//
// Schemas live at src/schema.json (v0.1), src/schema-0.2.json (v0.2),
// src/schema-0.4.json (v0.4), src/schema-0.5.json (v0.5), src/schema-0.6.json (v0.6),
// src/schema-0.7.json (v0.7), src/schema-0.8.json (v0.8), src/schema-0.9.json (v0.9),
// src/schema-0.10.json (v0.10), src/schema-0.11.json (v0.11),
// src/schema-0.12.json (v0.12), src/schema-0.13.json (v0.13),
// src/schema-0.14.json (v0.14), src/schema-0.15.json (v0.15), and
// src/schema-1.0.json (v1.0) — all
// gitignored except the v0.1 default, copied from the spec source by
// scripts/prebuild.mjs at build/test time.
// validate() routes by the parsed doc's anatomy_version.

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction, ErrorObject } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import schema_0_1 from "./schema.json" with { type: "json" };
import schema_0_2 from "./schema-0.2.json" with { type: "json" };
import schema_0_4 from "./schema-0.4.json" with { type: "json" };
import schema_0_5 from "./schema-0.5.json" with { type: "json" };
import schema_0_6 from "./schema-0.6.json" with { type: "json" };
import schema_0_7 from "./schema-0.7.json" with { type: "json" };
import schema_0_8 from "./schema-0.8.json" with { type: "json" };
import schema_0_9 from "./schema-0.9.json" with { type: "json" };
import schema_0_10 from "./schema-0.10.json" with { type: "json" };
import schema_0_11 from "./schema-0.11.json" with { type: "json" };
import schema_0_12 from "./schema-0.12.json" with { type: "json" };
import schema_0_13 from "./schema-0.13.json" with { type: "json" };
import schema_0_14 from "./schema-0.14.json" with { type: "json" };
import schema_0_15 from "./schema-0.15.json" with { type: "json" };
import schema_1_0 from "./schema-1.0.json" with { type: "json" };

// ajv-formats default-exports a callable plugin; TypeScript under NodeNext
// types CJS default imports as the module namespace, so we cast at the
// boundary. Runtime value IS the function.
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

export const supportedVersions = ["0.1", "0.2", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.15", "1.0"] as const;
export type SupportedVersion = (typeof supportedVersions)[number];

export const compiledSchemas: Map<string, ValidateFunction> = new Map([
  ["0.1", ajv.compile(schema_0_1)],
  ["0.2", ajv.compile(schema_0_2)],
  ["0.4", ajv.compile(schema_0_4)],
  ["0.5", ajv.compile(schema_0_5)],
  ["0.6", ajv.compile(schema_0_6)],
  ["0.7", ajv.compile(schema_0_7)],
  ["0.8", ajv.compile(schema_0_8)],
  ["0.9", ajv.compile(schema_0_9)],
  ["0.10", ajv.compile(schema_0_10)],
  ["0.11", ajv.compile(schema_0_11)],
  ["0.12", ajv.compile(schema_0_12)],
  ["0.13", ajv.compile(schema_0_13)],
  ["0.14", ajv.compile(schema_0_14)],
  ["0.15", ajv.compile(schema_0_15)],
  ["1.0", ajv.compile(schema_1_0)],
]);

export type AjvError = ErrorObject;
