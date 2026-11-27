# Portable Personal Agent — DeepSeek Harness plugin

This is the first vertical slice of the Portable Personal Agent Harness. It is a real
Cordis plugin for DeepSeek Harness, not a standalone imitation of its Agent Loop.

## What it provides

One model-callable tool, `personal_workspace`, backed by PostgreSQL:

- `save_memory`: save a durable user memory or preference.
- `search_memories`: search saved memories.
- `create_task`: create a persistent task.
- `update_task`: update a task's lifecycle status.
- `list_tasks`: list recent tasks.
- `dashboard`: return memory and task counts.

DeepSeek Harness continues to own the model adapter, Agent Loop, tool dispatch,
session events, permissions and runtime lifecycle. This plugin contributes a
tool through `ctx.tools.register()`.

## Requirements

- A checked-out DeepSeek Harness source tree.
- Node.js version supported by the pinned Harness revision.
- PostgreSQL 14+.
- A configured DeepSeek model route in the Harness profile.

The Harness API is in Developer Preview. Pin the Harness checkout to a commit and
validate this plugin against that exact revision before upgrading.

## Environment

Set these in the server process environment (never in browser/Vite variables):

```bash
PERSONAL_AGENT_DATABASE_URL=postgresql://user:password@localhost:5432/personal_agent
PERSONAL_AGENT_USER_ID=local-user
```

The plugin falls back to `DATABASE_URL` if the dedicated database URL is absent.

## Load locally

The official Harness plugin contract is a TypeScript module exporting `name`,
optional `inject`, and `apply(ctx)`. Tool registration uses the official
`@deepseek-ai/dsh-tools` `defineTool()` helper.

1. Put this directory inside a DeepSeek Harness source checkout, or expose it to
   that checkout as a local workspace package.
2. Make `pg` resolvable from the Harness host process.
3. Install/link this package into the profile using the Harness plugin/bundle workflow.
   Its `package.json` declares a `dsh.bundle`; its `cordis.patch.example.yml` uses
   the official insert-layer shape. Pin the Harness version before installing.
4. Start the Harness Web profile and open a session.
5. Ask the agent to save a preference, list tasks, or create a task.

## Security boundary

This is a trusted Host plugin: its code runs with the permissions of the Harness
process, not inside the Agent sandbox. Use a dedicated least-privilege PostgreSQL
role, restrict database network access, and do not install unreviewed third-party
code in the same process. The current MVP is single-user by default; set a distinct
`PERSONAL_AGENT_USER_ID` per authenticated user before exposing it to multiple users.

## MVP limitations

- No mobile client or sync protocol yet.
- No task scheduler or background worker yet.
- No X/Twitter collector yet.
- No Learning Coach or Coding Agent plugin yet.
- No encrypted secret vault or third-party plugin marketplace yet.
- Tasks are records only; status changes are initiated by the agent.
- This plugin persists its own memory/task data; it does not replace Harness Session
  persistence or serialize live process state.

## Verification status

The source is committed as an integration scaffold. It has not yet been installed
inside a pinned DeepSeek Harness checkout, type-checked, or exercised against a live
PostgreSQL/DeepSeek runtime. Those checks are required before calling it runnable.
