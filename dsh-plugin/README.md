# Portable Personal Agent — DeepSeek Harness plugin

This is the first runnable vertical slice of the Portable Personal Agent Harness.
It extends DeepSeek Harness through its Cordis plugin and tool APIs; it does not
implement a second Agent Loop.

## What it provides

The plugin registers one model-callable tool, `personal_workspace`, backed by PostgreSQL:

- `save_memory`: persist a memory or preference.
- `search_memories`: search the current user's saved memories.
- `create_task`: create a persistent task.
- `update_task`: update a task lifecycle status.
- `list_tasks`: list recent tasks.
- `dashboard`: return memory and task counts.

The plugin uses the documented `ctx.tools.register(defineTool(...))` contract.
The tool registration is automatically disposed with its Cordis plugin fiber.
The PostgreSQL pool is explicitly closed on plugin unload.

## Compatibility

- DeepSeek Harness: `0.2.3-alpha.2`
- Cordis: `4.2.0-alpha.1`
- Node.js: `^24.22.3 || >=26.13.1`
- PostgreSQL: 14+

The Harness API is in Developer Preview. Keep the Harness version pinned while
validating this plugin.

## Install into a Harness profile

First install the plugin's dependencies and compile its TypeScript entry point
to the JavaScript file loaded by the Harness runtime:

```bash
cd dsh-plugin
pnpm install
pnpm build
cd ..
```

Then, from the AGENT-FOUNDRY repository root, install the local bundle into a
profile. The Harness CLI links the package, reads its `dsh.bundle` manifest,
and adds its Cordis patch layer:

```bash
dsh plugin --profile personal-agent add ./dsh-plugin
dsh --profile personal-agent --dump-config
dsh --profile personal-agent
```

The dump should contain a `portable-personal-agent` layer. The bundle patch
references the installed package by its package name; its `main` entry points
to the compiled `lib/index.js`. The package keeps its own `pg` dependency
and declares Harness packages as peers plus development dependencies for
type-checking.
## Database setup

Create a dedicated database and apply the migration before starting Harness:

```bash
createdb personal_agent
psql "$PERSONAL_AGENT_DATABASE_URL" -v ON_ERROR_STOP=1 -f dsh-plugin/sql/001_init.sql
```

Set these variables in the Harness host process (not browser/Vite variables):

```bash
export PERSONAL_AGENT_DATABASE_URL='postgresql://user:password@localhost:5432/personal_agent'
export PERSONAL_AGENT_USER_ID='local-user'
```

The plugin falls back to `DATABASE_URL` if the dedicated URL is absent.
The user ID is deliberately taken from trusted host configuration, never from
model arguments. This initial demo is single-user; do not expose it as a
multi-user service until the identity comes from authenticated request context.

## Acceptance test

1. Start Harness with the plugin overlay and a configured DeepSeek model.
2. Ask the agent to save a distinctive preference, such as
   "Remember that my preferred editor is Zed."
3. Ask it to create a task.
4. Stop the Harness process completely.
5. Start it again and open a new Session.
6. Ask it to search for the saved preference and list tasks.

Expected result: the memory and task are returned from PostgreSQL in the new
Session. This validates persistence independently of Session history.

## Security and lifecycle boundaries

This is a trusted Host plugin: it runs with the permissions of the Harness
process, not inside the Agent sandbox. Use a least-privilege PostgreSQL role
and restrict database network access. Do not install unreviewed third-party
code into the same process.

The plugin does not replace Harness Session persistence and does not serialize
live process state. It persists only explicit memories and task records.

## Not implemented yet

- Cross-device sync API and mobile client.
- X/Twitter collection and scheduled delivery.
- Learning Coach and Coding Agent workflows.
- Authenticated multi-user identity resolution.
- Task scheduler, background worker, and durable execution checkpoints.
- Encrypted secret vault or third-party plugin marketplace.

## Verification status

The TypeScript source, compiled-JavaScript build path, bundle patch, and CI typecheck are committed as an integration implementation.
The exact pinned Harness checkout, TypeScript build, PostgreSQL integration,
and live model tool-call acceptance test still need to run before this can be
called fully verified.
