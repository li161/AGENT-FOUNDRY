import Database from '@tauri-apps/plugin-sql'

export type Role = 'user' | 'assistant' | 'system'
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'interrupted'
export interface Message {
  id: string; conversation_id: string; role: Role; content: string; status: MessageStatus
  model: string | null; created_at: string; updated_at: string
}
export interface Conversation { id: string; title: string; created_at: string; updated_at: string }
let database: Database | null = null
const stamp = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

export async function db() {
  if (database) return database
  database = await Database.load('sqlite:personal-agent.db')
  await database.execute('PRAGMA journal_mode=WAL')
  await database.execute('PRAGMA foreign_keys=ON')
  await database.execute(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  await database.execute(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
    model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  await database.execute('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)')
  await database.execute(`CREATE TABLE IF NOT EXISTS local_outbox (
    id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
  )`)
  await database.execute(`CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  // Any stream left unfinished by a crash is preserved, never silently discarded.
  const stale = await database.select<Message[]>("SELECT * FROM messages WHERE status IN ('pending','streaming')")
  for (const m of stale) {
    await database.execute("UPDATE messages SET status='interrupted', updated_at=$1 WHERE id=$2", [stamp(), m.id])
    await enqueue('message', m.id, 'upsert', { ...m, status: 'interrupted', updated_at: stamp() })
  }
  return database
}

export async function enqueue(entityType: string, entityId: string, operation: string, payload: unknown) {
  const d = await db()
  await d.execute('INSERT INTO local_outbox(id,entity_type,entity_id,operation,payload,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [newId(), entityType, entityId, operation, JSON.stringify(payload), stamp()])
}
export async function createConversation(title = '新的对话') {
  const d = await db(), id = newId(), t = stamp()
  await d.execute('INSERT INTO conversations(id,title,created_at,updated_at) VALUES($1,$2,$3,$3)', [id,title,t])
  const row = { id, title, created_at:t, updated_at:t }
  await enqueue('conversation', id, 'upsert', row)
  return row
}
export async function listConversations() {
  return (await (await db()).select<Conversation[]>('SELECT * FROM conversations ORDER BY updated_at DESC'))
}
export async function listMessages(conversationId: string) {
  return (await (await db()).select<Message[]>('SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC', [conversationId]))
}
export async function saveMessage(m: Message, sync = true) {
  const d = await db()
  await d.execute(`INSERT INTO messages(id,conversation_id,role,content,status,model,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content,status=excluded.status,model=excluded.model,updated_at=excluded.updated_at`,
    [m.id,m.conversation_id,m.role,m.content,m.status,m.model,m.created_at,m.updated_at])
  await d.execute('UPDATE conversations SET updated_at=$1 WHERE id=$2', [m.updated_at,m.conversation_id])
  if (sync) await enqueue('message', m.id, 'upsert', { id:m.id, conversationId:m.conversation_id, role:m.role, content:m.content, status:m.status, model:m.model, createdAt:m.created_at, updatedAt:m.updated_at })
}
export async function updateMessage(id: string, content: string, status: MessageStatus, model: string | null) {
  const d=await db(), t=stamp()
  await d.execute('UPDATE messages SET content=$1,status=$2,model=$3,updated_at=$4 WHERE id=$5',[content,status,model,t,id])
  return t
}
export async function getMeta(key: string) {
  const rows=await (await db()).select<{value:string}[]>('SELECT value FROM local_meta WHERE key=$1',[key])
  return rows[0]?.value ?? null
}
export async function setMeta(key: string,value: string) {
  await (await db()).execute('INSERT INTO local_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value])
}
export async function outboxBatch(limit=50) {
  return (await (await db()).select<{id:string;entity_type:string;entity_id:string;operation:string;payload:string;attempts:number}[]>('SELECT * FROM local_outbox ORDER BY rowid LIMIT $1',[limit]))
}
export async function deleteOutbox(ids: string[]) {
  const d=await db()
  for (const id of ids) await d.execute('DELETE FROM local_outbox WHERE id=$1',[id])
}
export async function failOutbox(id: string,error: string) {
  await (await db()).execute('UPDATE local_outbox SET attempts=attempts+1,last_error=$1 WHERE id=$2',[error.slice(0,500),id])
}