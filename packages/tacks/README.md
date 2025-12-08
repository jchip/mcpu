# Tacks

Lightweight issue tracker MCP server.

## Prerequisites

Install [bun](https://bun.sh):

```bash
curl -fsSL https://bun.sh/install | bash
```

## MCPU (Recommended)

[mcpu](https://www.npmjs.com/package/@mcpu/cli) manages all your mcp servers for multiple AI Assistants for progressive discovery and disclosure and reduce token usage by up to 84%.

If you are using mcpu, you can add this mcp server with the following command.

```bash
mcpu add --scope=user tacks --stdio -- bunx @mcpu/tacks
```

## Claude CLI

```bash
claude mcp add --scope=user  tacks -- bunx @mcpu/tacks
```

## Gemini CLI

```bash
gemini mcp add --scope=user --transport=stdio tacks bunx @mcpu/tacks
```

## Add to `CLAUDE.md` or `GEMINI.md`

```
### Important Rules

- ✅ Use mcp `tacks` for ALL task tracking.
- ✅ Always use the project's directory name for `proj` or `project_id`, and setup project with a 3 letter prefix for issues.
- ✅ Link discovered work with `add_dependency` and type `discovered-from`
- ✅ Check work queue for ready issues before asking "what should I work on?"
- ✅ ALWAYS write tests for a feature and test before committing.
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT clutter repo root with planning documents
```
