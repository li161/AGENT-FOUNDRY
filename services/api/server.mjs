import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'
import pg from 'pg'

const app=express()
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',')||true}))
app.use(express.json({limit:'2mb'}))
const tasks=new Map()
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}}):null
const now=()=>new Date().toISOString()
async function persist(task){
  if(!pool)return
  await pool.query(`CREATE TABLE IF NOT EXISTS foundry_tasks(id text primary key,status text not null,payload jsonb not null,updated_at timestamptz not null default now())`)
  await pool.query('INSERT INTO foundry_tasks(id,status,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=now()',[task.id,task.status,task])
}
async function callModel({message,agent,dependencyResults}){
  const key=process.env.DEEPSEEK_API_KEY
  if(!key)throw new Error('DEEPSEEK_API_KEY is not configured on the API server')
  const base=(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com').replace(/\/$/,'')
  const response=await fetch(base+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({
    model:process.env.DEEPSEEK_MODEL||'deepseek-chat',
    temperature:0.3,
    messages:[
      {role:'system',content:agent.instructions||'You are a specialist digital human. Be precise and distinguish evidence from assumptions.'},
      {role:'user',content:`任务目标：${message}\n\n上游岗位结果：\n${dependencyResults.length?dependencyResults.map(x=>x.agentName+':\n'+x.result).join('\n\n'):'无'}\n\n请完成你的岗位职责，给出可核验的结论。`}
    ]
  })})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error?.message||'DeepSeek HTTP '+response.status)
  return {content:data.choices?.[0]?.message?.content||'',model:data.model||process.env.DEEPSEEK_MODEL||'deepseek-chat',usage:data.usage||null}
}
async function execute(task){
  task.status='running';task.startedAt=now();await persist(task)
  const completed=new Map()
  const pending=new Set(task.tasks.map(t=>t.agentId))
  while(pending.size){
    const ready=task.tasks.filter(t=>pending.has(t.agentId)&&t.dependsOn.every(id=>completed.has(id)||task.tasks.find(x=>x.agentId===id)?.status==='failed'))
    if(!ready.length){
      for(const id of pending){const t=task.tasks.find(x=>x.agentId===id);t.status='blocked';t.error='Dependency did not complete'}
      break
    }
    await Promise.all(ready.map(async item=>{
      const failedDeps=item.dependsOn.filter(id=>task.tasks.find(x=>x.agentId===id)?.status==='failed'||task.tasks.find(x=>x.agentId===id)?.status==='blocked')
      if(failedDeps.length){item.status='blocked';item.error='Blocked by '+failedDeps.join(', ');pending.delete(item.agentId);return}
      item.status='running';item.startedAt=now();await persist(task)
      try{
        const deps=item.dependsOn.map(id=>completed.get(id)).filter(Boolean)
        const result=await callModel({message:task.message,agent:item,dependencyResults:deps})
        item.result=result.content;item.model=result.model;item.usage=result.usage;item.status='succeeded';item.completedAt=now();completed.set(item.agentId,{agentName:item.agentName,result:result.content})
      }catch(error){item.status='failed';item.error=error.message;item.completedAt=now()}
      pending.delete(item.agentId);await persist(task)
    }))
  }
  const states=task.tasks.map(t=>t.status)
  task.status=states.every(s=>s==='succeeded')?'completed':states.some(s=>s==='succeeded')?'partial':'failed'
  task.completedAt=now();await persist(task)
}
app.get('/health',async(_req,res)=>{let database='not_configured';if(pool){try{await pool.query('select 1');database='connected'}catch{database='error'}}res.json({ok:true,service:'agent-foundry-api',provider:'DeepSeek',model:process.env.DEEPSEEK_MODEL||'deepseek-chat',database})})
app.post('/api/chat',async(req,res)=>{
  const {message,agents}=req.body||{}
  if(typeof message!=='string'||!message.trim())return res.status(400).json({error:'message is required'})
  if(!Array.isArray(agents)||!agents.length)return res.status(400).json({error:'agents must be a non-empty array'})
  if(agents.length>12)return res.status(400).json({error:'maximum 12 agents per run'})
  const ids=new Set(agents.map(a=>a.id))
  if(ids.size!==agents.length||agents.some(a=>!a.id||!a.name))return res.status(400).json({error:'each agent needs a unique id and name'})
  for(const a of agents)if((a.dependsOn||[]).some(id=>!ids.has(id)))return res.status(400).json({error:'dependency references an unknown agent: '+a.id})
  const id=crypto.randomUUID()
  const task={id,message:message.trim(),status:'queued',createdAt:now(),provider:'DeepSeek',model:process.env.DEEPSEEK_MODEL||'deepseek-chat',tasks:agents.map(a=>({agentId:a.id,agentName:a.name,role:a.role||'',instructions:a.instructions||'',dependsOn:a.dependsOn||[],status:'queued',result:null,error:null}))}
  tasks.set(id,task);await persist(task)
  execute(task).catch(async error=>{task.status='failed';task.error=error.message;await persist(task)})
  res.status(202).json({taskId:id,status:'queued',provider:'DeepSeek',model:task.model})
})
app.get('/api/tasks/:id',async(req,res)=>{
  let task=tasks.get(req.params.id)
  if(!task&&pool){try{const row=await pool.query('select payload from foundry_tasks where id=$1',[req.params.id]);task=row.rows[0]?.payload}catch{}}
  if(!task)return res.status(404).json({error:'task not found'})
  res.json({task})
})
const port=Number(process.env.PORT||8787)
app.listen(port,()=>console.log('AGENT FOUNDRY API listening on '+port))