// src/render/identity.ts
// Polymorphic accessor for identity pillar values across v0.1-v0.7 shapes.
// v0.7 stores each pillar as a flat string at identity.<pillar>.
// v0.1-v0.6 wrap each pillar in an object { id, hash }.
// Display code in hook / show --prose / MCP overview's prose mode renders
// any version's anatomy and must handle both shapes — TypeScript types
// always describe v0.7 (because they're generated from spec/0.7/schema.json),
// so the runtime check is the only protection against `[object Object]`
// leaking into user-facing output for older docs.

export function pillarString(field: unknown): string {
  if (typeof field === "string") return field;
  if (field && typeof field === "object" && "id" in field) {
    const id = (field as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "";
}
