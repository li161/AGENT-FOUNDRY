import { deleteOutbox, failOutbox, getMeta, newId, outboxBatch, setMeta } from './db'
let syncing=false
export async function syncNow(baseUrl: string, token: string) {
  if(syncing||!baseUrl||!token)return
  syncing=true
  try{
    let deviceId=await getMeta('deviceId')
    if(!deviceId){deviceId=newId();await setMeta('deviceId',deviceId)}
    const headers={'Content-Type':'application/json','Authorization':`Bearer ${token}`}
    await fetch(`${baseUrl.replace(/\/$/,'')}/v1/devices/register`,{method:'POST',headers,body:JSON.stringify({deviceId,name:'Personal Agent Desktop',platform:navigator.platform})}).then(r=>{if(!r.ok)throw new Error('设备注册失败')})
    const batch=await outboxBatch()
    if(batch.length){
      const changes=batch.map(x=>({changeId:x.id,id:x.entity_id,entityType:x.entity_type,operation:x.operation,payload:JSON.parse(x.payload)}))
      const res=await fetch(`${baseUrl.replace(/\/$/,'')}/v1/sync/push`,{method:'POST',headers,body:JSON.stringify({deviceId,changes})})
      if(!res.ok)throw new Error(await res.text())
      const data=await res.json() as {accepted:string[]}
      const accepted=new Set(data.accepted)
      await deleteOutbox(batch.filter(x=>accepted.has(x.id)).map(x=>x.id))
    }
    const cursor=Number(await getMeta('syncCursor')||0)
    const pull=await fetch(`${baseUrl.replace(/\/$/,'')}/v1/sync/pull?deviceId=${encodeURIComponent(deviceId)}&after=${cursor}`,{headers})
    if(!pull.ok)throw new Error(await pull.text())
    const data=await pull.json() as {changes:Array<{cursor:number;entityType:string;entityId:string;operation:string;payload:any}>;nextCursor:number}
    // Pull application is intentionally conservative in this MVP: preserve remote events in a local inbox.
    for(const ch of data.changes) await (await import('./db')).enqueue('remote_'+ch.entityType,ch.entityId,ch.operation,ch.payload)
    await setMeta('syncCursor',String(data.nextCursor))
  }catch(error){
    console.warn('Background sync deferred:',error)
    const batch=await outboxBatch()
    for(const item of batch) await failOutbox(item.id,String(error))
  }finally{syncing=false}
}