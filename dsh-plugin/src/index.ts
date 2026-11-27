import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const { Pool } = pg

export const name = 'portable-personal-agent'
export const inject = ['tools']

const userId = process.env.PERSONAL_AGENT_USER_ID || 'local-user'
const pool = new Pool({
  connectionString: process.env.PERSONAL_AGENT_DATABASE_URL || process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
})

const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS ppa_memories (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    category text NOT NULL DEFAULT 'general',
    content text NOT NULL,
    source text NOT NULL DEFAULT 'agent',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ppa_memories_user_updated
    ON ppa_memories(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS ppa_tasks (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ppa_tasks_user_updated
    ON ppa_tasks(user_id, updated_at DESC);
`)

const tool = defineTool({
  name: 'personal_workspace',
  description: 'Manage the user personal workspace: save or search durable memories, create/update tasks, list tasks, and retrieve a compact dashboard. Use this for facts and preferences that should persist across sessions.',
  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['save_memory', 'search_memories', 'create_task', 'update_task', 'list_tasks', 'dashboard'],
      description: 'Operation to perform.',
    },
    content: { type: 'string', description: 'Memory content or task description.' },
    category: { type: 'string', description: 'Memory category, e.g. preference, project, profile, learning.' },
    title: { type: 'string', description: 'Task title.' },
    task_id: { type: 'string', description: 'Existing task ID for update.' },
    status: {
      type: 'string',
      enum: ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'],
      description: 'New task status.',
    },
    query: { type: 'string', description: 'Optional text to search memories.' },
    limit: { type: 'integer', description: 'Maximum records to return (1–30).' },
  },
  output: {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  timeoutMs: 15_000,
  async execute(args) {
    await ready
    const limit = Math.max(1, Math.min(args.limit ?? 10, 30))

    if (args.action === 'save_memory') {
      if (!args.content?.trim()) throw new Error('content is required')
      const id = randomUUID()
      const result = await pool.query(
        'INSERT INTO ppa_memories(id,user_id,category,content) VALUES($1,$2,$3,$4) RETURNING id,category,content,created_at',
        [id, userId, args.category || 'general', args.content.trim()],
      )
      return { ok: true, memory: result.rows[0] }
    }

    if (args.action === 'search_memories') {
      const result = await pool.query(
        `SELECT id,category,content,created_at,updated_at
         FROM ppa_memories
         WHERE user_id=$1 AND ($2 = '' OR content ILIKE '%' || $2 || '%' OR category ILIKE '%' || $2 || '%')
         ORDER BY updated_at DESC LIMIT $3`,
        [userId, args.query || '', limit],
      )
      return { ok: true, memories: result.rows }
    }

    if (args.action === 'create_task') {
      if (!args.title?.trim()) throw new Error('title is required')
      const id = randomUUID()
      const result = await pool.query(
        'INSERT INTO ppa_tasks(id,user_id,title,description) VALUES($1,$2,$3,$4) RETURNING *',
        [id, userId, args.title.trim(), args.content || ''],
      )
      return { ok: true, task: result.rows[0] }
    }

    if (args.action === 'update_task') {
      if (!args.task_id || !args.status) throw new Error('task_id and status are required')
      const result = await pool.query(
        'UPDATE ppa_tasks SET status=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',
        [args.task_id, userId, args.status],
      )
      if (!result.rowCount) throw new Error('task not found')
      return { ok: true, task: result.rows[0] }
    }

    if (args.action === 'list_tasks') {
      const result = await pool.query(
        'SELECT * FROM ppa_tasks WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2',
        [userId, limit],
      )
      return { ok: true, tasks: result.rows }
    }

    const [memories, tasks] = await Promise.all([
      pool.query('SELECT count(*)::int AS count FROM ppa_memories WHERE user_id=$1', [userId]),
      pool.query('SELECT status,count(*)::int AS count FROM ppa_tasks WHERE user_id=$1 GROUP BY status', [userId]),
    ])
    return { ok: true, memories: memories.rows[0].count, tasks: tasks.rows }
  },
})

export function apply(ctx: Context) {
  const disposeTool = ctx.tools.register(tool)
  ctx.effect(() => () => {
    disposeTool()
    void pool.end()
  })
}
