<script setup>
import {computed,onBeforeUnmount,onMounted,ref} from 'vue'
import * as THREE from 'three'
const api=ref(import.meta.env.VITE_AGENT_API||'http://localhost:8787')
const space=ref('world'),selected=ref('planner'),mission=ref('请分析门店当前库存风险，并给出可执行的补货建议。')
const busy=ref(false),status=ref('READY'),taskId=ref(''),events=ref([]),runs=ref([])
const selectedIds=ref(['planner','inventory','buyer','auditor'])
const agentStates=ref({}),notice=ref('')
const host=ref(null)
const agents=[
{id:'planner',name:'林舟',role:'任务规划师',title:'ORCHESTRATOR',color:'#8c9cff',outfit:0x304a68,pos:[-3,0,0],instructions:'你是任务规划师。分析用户目标，将复杂问题拆成可执行的工作步骤，明确依赖关系和交付标准。不得编造业务数据。'},
{id:'inventory',name:'周岚',role:'库存分析师',title:'INVENTORY',color:'#64d9c2',outfit:0x285b55,pos:[0,0,-1],instructions:'你是库存分析师。分析库存风险、缺货和滞销问题。没有数据时明确列出需要的数据，不得捏造库存数字。'},
{id:'buyer',name:'陈默',role:'采购专员',title:'PROCUREMENT',color:'#f0bd75',outfit:0x70503a,pos:[3,0,0],instructions:'你是采购专员。结合上游分析提出采购建议，说明数量计算公式、供应风险和人工审批点。'},
{id:'auditor',name:'许知',role:'质量审核员',title:'QUALITY',color:'#d99adf',outfit:0x593d63,pos:[0,0,2.4],instructions:'你是质量审核员。审查上游结果的证据、逻辑和可执行性，标记未经证实的推断和缺失数据。'}
]
const person=computed(()=>agents.find(a=>a.id===selected.value)||agents[0])
const successRuns=computed(()=>runs.value.filter(r=>r.status==='completed').length)
const samples=computed(()=>runs.value.flatMap(r=>(r.tasks||[]).filter(t=>t.status==='succeeded'&&t.result).map(t=>({text:`### Task\n${r.message}\n\n### Role\n${t.role||t.agentName}\n\n### Context\nDependencies: ${(t.dependsOn||[]).join(', ')||'none'}\n\n### Response\n${t.result}`}))))
let renderer,scene,camera,raf,resizeObserver,raycaster,drag=null,dragPlane
const roots=new Map(),pickables=[]
function log(type,message,detail=''){events.value.unshift({id:crypto.randomUUID(),time:new Date().toLocaleTimeString(),type,message,detail});events.value=events.value.slice(0,60)}
function addHuman(a){
 const g=new THREE.Group();g.position.set(...a.pos);g.userData.agentId=a.id
 const skin=new THREE.MeshStandardMaterial({color:0xc99478,roughness:.8}),cloth=new THREE.MeshStandardMaterial({color:a.outfit,roughness:.7}),pants=new THREE.MeshStandardMaterial({color:0x202a35,roughness:.85}),hair=new THREE.MeshStandardMaterial({color:0x29252a,roughness:.95})
 const mesh=(geo,mat,x,y,z,sx=1,sy=1,sz=1)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;g.add(m);m.userData.agentId=a.id;pickables.push(m);return m}
 mesh(new THREE.CapsuleGeometry(.39,.66,6,14),cloth,0,1.15,0)
 mesh(new THREE.CylinderGeometry(.12,.14,.2,12),skin,0,1.68,0)
 mesh(new THREE.SphereGeometry(.37,24,20),skin,0,2.03,0,.87,1.1,.9)
 mesh(new THREE.SphereGeometry(.39,20,12,0,Math.PI*2,0,Math.PI*.48),hair,0,2.19,-.015,.92,1,.92)
 for(const x of [-.13,.13])mesh(new THREE.SphereGeometry(.033,10,8),new THREE.MeshStandardMaterial({color:0x17151a}),x,2.07,.325)
 mesh(new THREE.SphereGeometry(.045,10,8),skin,0,1.99,.35)
 for(const s of [-1,1]){
  const arm=mesh(new THREE.CapsuleGeometry(.105,.52,4,10),cloth,s*.48,1.19,0);arm.rotation.z=s*.12
  mesh(new THREE.SphereGeometry(.11,12,10),skin,s*.51,.82,.01)
  mesh(new THREE.CapsuleGeometry(.14,.48,4,10),pants,s*.18,.42,0)
  mesh(new THREE.BoxGeometry(.25,.12,.36),pants,s*.18,.12,.08)
 }
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.72,.012,8,48),new THREE.MeshBasicMaterial({color:a.color,transparent:true,opacity:.5}))
 ring.rotation.x=Math.PI/2;ring.position.y=.035;g.add(ring);g.userData.ring=ring
 const light=new THREE.PointLight(a.color,1.2,3.2);light.position.set(0,2.4,.1);g.add(light)
 scene.add(g);roots.set(a.id,g)
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=110
 const c=canvas.getContext('2d');c.fillStyle='#101d29dd';c.roundRect(4,4,504,102,18);c.fill();c.strokeStyle=a.color;c.stroke()
 c.font='600 32px Arial';c.fillStyle='#e7f0f7';c.textAlign='center';c.fillText(a.name+'  /  '+a.title,256,68)
 const tex=new THREE.CanvasTexture(canvas),label=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}))
 label.scale.set(2.3,.5,1);label.position.set(a.pos[0],3.05,a.pos[2]);scene.add(label)
}
function initWorld(){
 if(!host.value)return
 scene=new THREE.Scene();scene.background=new THREE.Color(0x080d13);scene.fog=new THREE.FogExp2(0x080d13,.035)
 camera=new THREE.PerspectiveCamera(42,host.value.clientWidth/host.value.clientHeight,.1,100);camera.position.set(0,5.7,12.5);camera.lookAt(0,1,0)
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.value.clientWidth,host.value.clientHeight);renderer.shadowMap.enabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;host.value.appendChild(renderer.domElement)
 scene.add(new THREE.HemisphereLight(0xc5ddff,0x111722,2))
 const key=new THREE.DirectionalLight(0xffe5c6,3);key.position.set(-4,9,5);key.castShadow=true;scene.add(key)
 const rim=new THREE.PointLight(0x3c8dff,22,22);rim.position.set(4,5,-5);scene.add(rim)
 const floor=new THREE.Mesh(new THREE.CircleGeometry(14,80),new THREE.MeshStandardMaterial({color:0x111b25,metalness:.4,roughness:.6}));floor.rotation.x=-Math.PI/2;floor.position.y=-.05;floor.receiveShadow=true;scene.add(floor)
 const grid=new THREE.GridHelper(24,48,0x27465c,0x1a2b39);grid.position.y=-.035;scene.add(grid)
 const platform=new THREE.Mesh(new THREE.CylinderGeometry(5.8,6.2,.16,80),new THREE.MeshStandardMaterial({color:0x152534,metalness:.5,roughness:.4}));platform.position.y=.02;scene.add(platform)
 const edge=new THREE.Mesh(new THREE.TorusGeometry(5.8,.03,10,120),new THREE.MeshBasicMaterial({color:0x3989b7}));edge.rotation.x=Math.PI/2;edge.position.y=.12;scene.add(edge)
 const starGeo=new THREE.BufferGeometry(),pos=[];for(let i=0;i<450;i++)pos.push((Math.random()-.5)*34,Math.random()*13+1,(Math.random()-.5)*34);starGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));scene.add(new THREE.Points(starGeo,new THREE.PointsMaterial({color:0x6ca8ca,size:.025,transparent:true,opacity:.55})))
 agents.forEach(addHuman);raycaster=new THREE.Raycaster();dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0)
 const point=e=>{const r=renderer.domElement.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1)}
 const down=e=>{raycaster.setFromCamera(point(e),camera);const hit=raycaster.intersectObjects(pickables,false)[0];if(hit){const id=hit.object.userData.agentId;selected.value=id;drag=roots.get(id);renderer.domElement.setPointerCapture(e.pointerId)}}
 const move=e=>{if(!drag)return;raycaster.setFromCamera(point(e),camera);const p=new THREE.Vector3();if(raycaster.ray.intersectPlane(dragPlane,p)){drag.position.x=THREE.MathUtils.clamp(p.x,-5,5);drag.position.z=THREE.MathUtils.clamp(p.z,-4,4)}}
 const up=()=>{drag=null}
 renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up)
 resizeObserver=new ResizeObserver(()=>{if(!renderer)return;const w=host.value.clientWidth,h=host.value.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h)});resizeObserver.observe(host.value)
 const animate=()=>{raf=requestAnimationFrame(animate);const t=performance.now()*.001;roots.forEach((g,id)=>{g.position.y=.04+Math.sin(t*1.4+agents.findIndex(a=>a.id===id))*.035;g.rotation.y=Math.sin(t*.3+agents.findIndex(a=>a.id===id))*.07;g.userData.ring.material.opacity=id===selected.value?.95:.28;g.userData.ring.scale.setScalar(id===selected.value?1.2:1)});renderer.render(scene,camera)}
 animate()
}
function disposeWorld(){cancelAnimationFrame(raf);resizeObserver?.disconnect();if(renderer){renderer.dispose();renderer.domElement.remove()}scene?.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())});renderer=null}
function setSpace(v){space.value=v}
function toggleAgent(id){selectedIds.value=selectedIds.value.includes(id)?selectedIds.value.filter(x=>x!==id):[...selectedIds.value,id]}
function graphConfig(){
 const ids=selectedIds.value
 return ids.map(id=>{const a=agents.find(x=>x.id===id);const deps=id==='planner'?[]:id==='inventory'?['planner']:id==='buyer'?['inventory']:['buyer'];return {...a,dependsOn:deps.filter(d=>ids.includes(d))}})
}
async function execute(){
 if(busy.value||!mission.value.trim())return
 if(!selectedIds.value.length){log('error','至少选择一个数字人');return}
 busy.value=true;status.value='RUNNING';events.value=[];taskId.value='';log('system','提交真实 Harness 任务',mission.value)
 const base=api.value.replace(/\/$/,'')
 try{
  const res=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({message:mission.value,agents:graphConfig()})})
  const body=await res.json();if(!res.ok)throw Error(body.error||'API '+res.status);if(!body.taskId)throw Error('API 未返回 taskId')
  taskId.value=body.taskId;log('system','Harness 已接收',body.taskId)
  const deadline=Date.now()+120000;let snapshot
  while(Date.now()<deadline){
   const r=await fetch(base+'/api/tasks/'+encodeURIComponent(body.taskId));const d=await r.json();if(!r.ok)throw Error(d.error||'无法读取任务状态');snapshot=d.task
   for(const t of snapshot.tasks||[]){agentStates.value={...agentStates.value,[t.agentId]:t.status};const key=t.agentId+':'+t.status;if(!events.value.some(e=>e.key===key))events.value.unshift({id:crypto.randomUUID(),key,time:new Date().toLocaleTimeString(),type:t.status,message:t.agentName+' · '+t.status,detail:t.error||t.result||''})}
   if(['completed','partial','failed'].includes(snapshot.status))break
   await new Promise(r=>setTimeout(r,1100))
  }
  if(!snapshot)throw Error('未能获取任务快照')
  status.value=snapshot.status.toUpperCase()
  const run={...snapshot,provider:body.provider,model:body.model};runs.value.unshift(run);saveRuns();log('system','任务结束',snapshot.status)
 }catch(e){status.value='ERROR';log('error','执行失败',e.message)}
 finally{busy.value=false}
}
const STORAGE='agent-foundry-runs-v1'
function saveRuns(){try{localStorage.setItem(STORAGE,JSON.stringify(runs.value.slice(0,100)))}catch{}}
function loadRuns(){try{const x=JSON.parse(localStorage.getItem(STORAGE)||'[]');if(Array.isArray(x))runs.value=x}catch{}}
function exportData(){
 if(!samples.value.length){notice.value='暂无成功轨迹。先执行一项真实任务。';return}
 const blob=new Blob([samples.value.map(x=>JSON.stringify(x)).join('\n')+'\n'],{type:'application/x-ndjson'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='foundry-sft-'+new Date().toISOString().slice(0,10)+'.jsonl';a.click();URL.revokeObjectURL(url);notice.value='已导出 '+samples.value.length+' 条成功样本。'
}
onMounted(()=>{loadRuns();initWorld()})
onBeforeUnmount(disposeWorld)
</script>
<template>
<main class="foundry">
<header class="topbar"><a class="brand" href="#"><b class="brand-icon">AF</b><span><strong>AGENT FOUNDRY</strong><small>BUILD · TRAIN · EVOLVE</small></span></a><div class="top-center"><i></i> EXPERIMENT ENVIRONMENT <em>WORLD 001</em></div><a class="top-link" href="https://github.com/li161/AGENT-FOUNDRY">SOURCE ↗</a></header>
<nav class="nav"><button v-for="(n,i) in [{id:'world',name:'WORLD'},{id:'harness',name:'HARNESS'},{id:'distill',name:'DISTILL'},{id:'arena',name:'ARENA'}]" :key="n.id" :class="{active:space===n.id}" @click="setSpace(n.id)"><small>0{{i+1}}</small>{{n.name}}</button></nav>
<section class="stage"><div ref="host" class="three-world"></div><div class="stage-shade"></div><div class="stage-title"><small>THE AGENT ECOSYSTEM / 001</small><h1>{{space==='world'?'A WORLD OF DIGITAL MINDS':space==='harness'?'DESIGN HOW THEY THINK':space==='distill'?'TRANSFER THE CAPABILITY':'PUT THEM TO THE TEST'}}</h1><p>真实执行 · 可观察轨迹 · 可复现训练</p></div><div class="scene-label"><i></i> THREE.JS WORLD ONLINE</div><div class="stage-hint">CLICK TO SELECT · DRAG TO REPOSITION</div>
<div class="agent-strip"><button v-for="a in agents" :key="a.id" :class="{chosen:selected===a.id}" @click="selected=a.id"><i :style="{background:a.color}"></i><span><b>{{a.name}}</b><small>{{a.role}}</small></span><em>{{agentStates[a.id]||'IDLE'}}</em></button></div>
<aside class="inspector"><small class="overline">DIGITAL HUMAN / {{person.title}}</small><div class="person"><b :style="{color:person.color,borderColor:person.color}">{{person.name.slice(0,1)}}</b><span><strong>{{person.name}}</strong><small>{{person.role}}</small></span></div><p>{{person.instructions}}</p><div class="inspector-row"><small>RUNTIME</small><strong>{{agentStates[selected]||'STANDBY'}}</strong></div><div class="inspector-row"><small>MODEL PROVIDER</small><strong>DEEPSEEK API</strong></div><button class="include" @click="toggleAgent(selected)">{{selectedIds.includes(selected)?'REMOVE FROM RUN':'ADD TO HARNESS'}} <b>↗</b></button></aside>
<div class="world-prompt" v-if="space==='world'"><b>THE LAB IS ALIVE</b><span>选择一位数字人，给它一个目标。</span></div></section>
<section class="mission"><div class="mission-label"><i></i><b>MISSION CONTROL</b><small>{{status}}</small></div><textarea v-model="mission" :disabled="busy" rows="2" placeholder="向你的数字人团队下达一个目标…"></textarea><button :disabled="busy||!mission.trim()" @click="execute">{{busy?'RUNNING':'EXECUTE'}} <b>{{busy?'◌':'↗'}}</b></button></section>
<section class="lower">
<div class="work-panel"><div class="panel-head"><div><small>{{space.toUpperCase()}} / LIVE WORKSPACE</small><h2>{{space==='world'?'协作现场':space==='harness'?'Harness 依赖编排':space==='distill'?'蒸馏数据舱':'实验竞技场'}}</h2></div><span><i></i>{{busy?'LIVE RUN':'READY'}}</span></div>
<div v-if="space==='world'" class="team-grid"><article class="mission-card"><small>CURRENT MISSION</small><h3>{{mission||'等待输入任务'}}</h3><p>执行时将调用后端 DeepSeek Harness，按依赖关系并行调度岗位。</p><footer>{{selectedIds.length}} AGENTS SELECTED <b>{{runs.length}} RECORDED RUNS</b></footer></article><article class="team-card"><small>TEAM COMPOSITION · CLICK TO TOGGLE</small><button v-for="a in agents" :key="a.id" @click="toggleAgent(a.id)"><i :class="{on:selectedIds.includes(a.id)}">{{selectedIds.includes(a.id)?'✓':'+'}}</i><span><b>{{a.name}}</b><small>{{a.role}}</small></span><em>{{a.title}}</em></button></article></div>
<div v-else-if="space==='harness'" class="graph-area"><div class="graph-top"><b>DEPENDENCY GRAPH</b><small>RULE-FIRST · DAG · PARALLEL READY NODES</small></div><div class="graph-nodes"><div v-for="(a,i) in graphConfig()" :key="a.id" class="graph-node" :class="{selected:selected===a.id}" @click="selected=a.id"><small>0{{i+1}}</small><b>{{a.name}}</b><span>{{a.role}}</span><em>{{a.dependsOn.length?'DEPENDS: '+a.dependsOn.join(', '):'ROOT TASK'}}</em></div></div><p>成员选择会改变发送到 Harness API 的 agents 与 dependsOn 配置；上游完成后才调度下游节点。</p></div>
<div v-else-if="space==='distill'" class="distill-area"><div><small>TEACHER → STUDENT</small><h3>从真实执行中提取能力</h3><p>只收集成功任务结果作为文本 SFT 样本；失败轨迹不会自动进入训练集。</p></div><div class="stats"><article><b>{{runs.length}}</b><small>EXECUTIONS</small></article><article><b>{{samples.length}}</b><small>SUCCESS SAMPLES</small></article><article><b>{{successRuns}}</b><small>COMPLETED RUNS</small></article></div><div class="actions"><button @click="exportData">EXPORT SFT DATASET ↗</button><a href="https://github.com/li161/AGENT-FOUNDRY/tree/main/training">TRAINING CODE ↗</a></div><p class="notice">{{notice}}</p><div class="caveat">当前训练器实现文本行为 SFT。结构化工具调用蒸馏、留出集评估、Student 在线推理接入尚未实现。</div></div>
<div v-else class="arena-area"><small>BENCHMARK / REAL RECORDS ONLY</small><h3>同一任务，不同策略</h3><p>当前仅展示真实执行记录，不生成模拟成功率或虚构成绩。</p><div class="stats"><article><b>{{runs.length}}</b><small>RUNS</small></article><article><b>{{successRuns}}</b><small>COMPLETED</small></article><article><b>{{samples.length}}</b><small>TRAIN SAMPLES</small></article></div><div v-for="r in runs.slice(0,5)" :key="r.id" class="run-row"><span><b>{{r.message}}</b><small>{{r.createdAt}} · {{r.model||'DeepSeek'}}</small></span><strong :class="r.status">{{r.status}}</strong></div></div>
</div>
<aside class="trace-panel"><div class="trace-head"><div><small>OBSERVABILITY / TRACE</small><h3>运行事件</h3></div><b>{{events.length.toString().padStart(2,'0')}}</b></div><div v-if="events.length" class="trace-list"><article v-for="e in events.slice(0,12)" :key="e.id"><i :class="e.type"></i><span><b>{{e.message}}</b><small>{{e.time}}</small><p v-if="e.detail">{{e.detail.slice(0,220)}}</p></span></article></div><div v-else class="empty"><b>◌</b><strong>等待运行事件</strong><p>执行任务后，这里显示真实后端状态与结果。</p></div><label class="api-config">HARNESS API ENDPOINT<input v-model="api" placeholder="https://your-api.example.com"/></label></aside>
</section>
<footer class="foot"><b>AGENT FOUNDRY 2.0</b><span>REAL RUNTIME · TRACEABLE DATA · REPRODUCIBLE EXPERIMENTS</span><a href="https://github.com/li161/AGENT-FOUNDRY">GITHUB ↗</a></footer>
</main>
</template>
