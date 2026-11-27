import type { Message } from './db'
export async function* streamChat(endpoint: string, apiKey: string, model: string, messages: Message[], signal: AbortSignal) {
  const localHost = (() => { try { const host = new URL(endpoint).hostname; return host === 'localhost' || host === '127.0.0.1' || host === '::1' } catch { return false } })()
  if (!apiKey.trim() && !localHost) throw new Error('云端模型需要 API Key；本地 Ollama 地址可以留空')
  const headers: Record<string,string> = { 'Content-Type':'application/json' }
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey}`
  const response=await fetch(endpoint,{method:'POST',signal,headers,
    body:JSON.stringify({model,stream:true,messages:messages.map(m=>({role:m.role,content:m.content}))})})
  if(!response.ok) throw new Error(`模型请求失败 (${response.status}): ${(await response.text()).slice(0,500)}`)
  if(!response.body) throw new Error('当前响应不支持流式读取')
  const reader=response.body.getReader(),decoder=new TextDecoder()
  let buffer=''
  while(true){
    const {value,done}=await reader.read()
    if(done)break
    buffer+=decoder.decode(value,{stream:true})
    const lines=buffer.split('\n');buffer=lines.pop()||''
    for(const line of lines){
      const trimmed=line.trim()
      if(!trimmed.startsWith('data:'))continue
      const data=trimmed.slice(5).trim()
      if(data==='[DONE]')return
      try{const json=JSON.parse(data);const delta=json.choices?.[0]?.delta?.content;if(typeof delta==='string'&&delta)yield delta}
      catch(error){if(error instanceof SyntaxError)continue;throw error}
    }
  }
}