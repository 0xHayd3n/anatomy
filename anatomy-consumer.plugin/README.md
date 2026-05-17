# anatomy-consumer (Claude Code plugin)

Loads `.anatomy` + `.anatomy-memory` into Claude Code's runtime context — both ambient (via a SessionStart hook injecting ~1,200 tokens of identity, rules, decisions, flows, commands, and entry points) and structured (via 11 MCP tools for selective deeper pulls).

## Install

### Claude Code

```bash
/plugin install anatomy-consumer
```

You'll need `@anatomy/cli` v0.9.0+ on `PATH` first:

```bash
npm install -g @anatomy/cli
```

### Manual (Cursor, Aider, generic MCP clients)

Add to your client's settings the equivalent of:

**SessionStart hook (Claude Code-style):**
```json
{
  "hooks": {
    "SessionStart": [{ "command": "anatomy hook" }]
  }
}
```

**MCP server (any MCP-compatible client):**
```json
{
  "mcpServers": {
    "anatomy": { "command": "anatomy", "args": ["mcp"] }
  }
}
```

## Telemetry

Records hook fires and MCP tool calls to `~/.anatomy/telemetry.jsonl` for usage analysis. Local-only, no network. Inspect with:

```bash
anatomy telemetry stats
```

Wipe with:

```bash
anatomy telemetry clear
```

## Privacy

Telemetry includes `repo_fingerprint`, `cwd`, tool args (filters and queries), result sizes, and timing. **No file contents are logged.** All data stays on your machine.
