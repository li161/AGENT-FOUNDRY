import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const { Pool } = pg

export const name = 'portable-personal-agent'
export const inject = ['tools']

type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

const taskStatuses: TaskStatus[] = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]

export function apply(ctx: Context): void {
  const connectionString =
    process.env.PERSONAL_AGENT_DATABASE_URL || process.env.DATABASE_URL
  const userId = process.env.PERSONAL_AGENT_USER_ID

  if (!connectionString) {
    throw new Error(
      'portable-personal-agent: set PERSONAL_AGENT_DATABASE_URL (or DATABASE_URL) before loading the plugin',
    )
  }
  if (!userId?.trim()) {
    throw new Error(
      'portable-personal-agent: set PERSONAL_AGENT_USER_ID to the authenticated single-user identity',
    )
  }

  // The pool is created inside apply so importing the module has no side effects.
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  ctx.effect(() => {
    return () => pool.end()
  }, 'portable-personal-agent: postgres pool')

  ctx.tools.register(defineTool({
    name: 'personal_workspace',
    description:
      'Manage the current user personal workspace. Save durable memories, search saved memories, create or update tasks, list tasks, and retrieve a compact dashboard. Never use this tool to change the user identity.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [
          'save_memory',
          'search_memories',
          'create_task',
          'update_task',
          'list_tasks',
          'dashboard',
        ],
        description: 'Operation to perform.',
      },
      content: {
        type: 'string',
        description: 'Memory content or task description.',
      },
      category: {
        type: 'string',
        description: 'Memory category, e.g. preference, project, profile, learning.',
      },
      title: { type: 'string', description: 'Task title.' },
      task_id: { type: 'string', description: 'Existing task ID for update.' },
      status: {
        type: 'string',
        enum: taskStatuses,
        description: 'New task status.',
      },
      query: { type: 'string', description: 'Optional text to search memories.' },
      limit: { type: 'integer', description: 'Maximum records to return (1–30).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [
        { type: 'text', text: JSON.stringify(value, null, 2) },
      ],
    },
    timeoutMs: 15_000,
    async execute(args) {
      const limit = Math.max(1, Math.min(args.limit ?? 10, 30))

      if (args.action === 'save_memory') {
        const content = args.content?.trim()
        if (!content) throw new Error('content is required')
        const result = await pool.query(
          `INSERT INTO ppa_memories(id, user_id, category, content)
           VALUES($1, $2, $3, $4)
           RETURNING id, category, content, created_at`,
          [randomUUID(), userId, args.category?.trim() || 'general', content],
        )
        return { ok: true, memory: result.rows[0] }
      }

      if (args.action === 'search_memories') {
        const result = await pool.query(
          `SELECT id, category, content, created_at, updated_at
           FROM ppa_memories
           WHERE user_id = $1
             AND ($2 = '' OR content ILIKE '%' || $2 || '%' OR category ILIKE '%' || $2 || '%')
           ORDER BY updated_at DESC
           LIMIT $3`,
          [userId, args.query?.trim() || '', limit],
        )
        return { ok: true, memories: result.rows }
      }

      if (args.action === 'create_task') {
        const title = args.title?.trim()
        if (!title) throw new Error('title is required')
        const result = await pool.query(
          `INSERT INTO ppa_tasks(id, user_id, title, description)
           VALUES($1, $2, $3, $4)
           RETURNING id, title, description, status, created_at, updated_at`,
          [randomUUID(), userId, title, args.content?.trim() || ''],
        )
        return { ok: true, task: result.rows[0] }
      }

      if (args.action === 'update_task') {
        if (!args.task_id?.trim() || !args.status) {
          throw new Error('task_id and status are required')
        }
        if (!taskStatuses.includes(args.status as TaskStatus)) {
          throw new Error('invalid task status')
        }
        const result = await pool.query(
          `UPDATE ppa_tasks
           SET status = $3, updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING id, title, description, status, created_at, updated_at`,
          [args.task_id, userId, args.status],
        )
        if (result.rows.length === 0) throw new Error('task not found')
        return { ok: true, task: result.rows[0] }
      }

      if (args.action === 'list_tasks') {
        const result = await pool.query(
          `SELECT id, title, description, status, created_at, updated_at
           FROM ppa_tasks
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT $2`,
          [userId, limit],
        )
        return { ok: true, tasks: result.rows }
      }

      const [memories, tasks] = await Promise.all([
        pool.query(
          'SELECT count(*)::int AS count FROM ppa_memories WHERE user_id = $1',
          [userId],
        ),
        pool.query(
          `SELECT status, count(*)::int AS count
           FROM ppa_tasks
           WHERE user_id = $1
           GROUP BY status
           ORDER BY status`,
          [userId],
        ),
      ])
      return {
        ok: true,
        memories: memories.rows[0]?.count ?? 0,
        tasks: tasks.rows,
      }
    },
  }))
}
