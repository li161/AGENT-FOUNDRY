import type { Message } from './db'
export async function* streamChat(endpoint: string, apiKey: string, model: string, messages: Message[], signal: AbortSignal) {
  if (!apiKey.trim()) throw new Error('请先在设置中填写模型 API Key')
  const response=await fetch(endpoint,{method:'POST',signal,headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},
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