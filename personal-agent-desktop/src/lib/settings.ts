import { load } from '@tauri-apps/plugin-store'
export interface Settings { endpoint: string; model: string; apiKey: string; syncUrl: string; syncToken: string }
const defaults: Settings = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', apiKey: '', syncUrl: '', syncToken: '' }
export async function readSettings(): Promise<Settings> {
  const store=await load('settings.json',{autoSave:true})
  return { endpoint: await store.get<string>('endpoint') ?? defaults.endpoint,
    model: await store.get<string>('model') ?? defaults.model,
    apiKey: await store.get<string>('apiKey') ?? '',
    syncUrl: await store.get<string>('syncUrl') ?? '',
    syncToken: await store.get<string>('syncToken') ?? '' }
}
export async function writeSettings(s: Settings) {
  const store=await load('settings.json',{autoSave:true})
  for (const [k,v] of Object.entries(s)) await store.set(k,v)
  await store.save()
}