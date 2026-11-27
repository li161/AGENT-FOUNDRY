import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Message } from './db'

interface StreamEvent { requestId: string; token?: string; done?: boolean }
export async function* streamChat(endpoint: string, apiKey: string, model: string, messages: Message[]) {
  const localHost = (() => { try { const host = new URL(endpoint).hostname; return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' } catch { return false } })()
  if (!apiKey.trim() && !localHost) throw new Error('云端模型需要 API Key；本地 Ollama 地址可以留空')
  const requestId=crypto.randomUUID(),queue:string[]=[]
  let done=false,failure:unknown=null,wake:(()=>void)|null=null
  const unlisten=await listen<StreamEvent>('model-stream',event=>{
    if(event.payload.requestId!==requestId)return
    if(event.payload.token)queue.push(event.payload.token)
    if(event.payload.done)done=true
    wake?.();wake=null
  })
  const request=invoke<void>('chat_stream',{
    requestId,endpoint,apiKey,model,
    messages:messages.map(m=>({role:m.role,content:m.content}))
  }).then(()=>{done=true;wake?.();wake=null}).catch(error=>{failure=error;done=true;wake?.();wake=null})
  try{
    while(!done||queue.length){
      if(queue.length){yield queue.shift()!;continue}
      await new Promise<void>(resolve=>{wake=resolve})
    }
    if(failure)throw new Error(String(failure))
    await request
  }finally{unlisten()}
}
