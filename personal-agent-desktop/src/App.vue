<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createConversation, listConversations, listMessages, newId, saveMessage, updateMessage, type Conversation, type Message } from './lib/db'
import { readSettings, writeSettings, type Settings } from './lib/settings'
import { streamChat } from './lib/model'
import { syncNow } from './lib/sync'

const conversations=ref<Conversation[]>([]),activeId=ref(''),messages=ref<Message[]>([]),draft=ref('')
const busy=ref(false),error=ref(''),showSettings=ref(false),settings=ref<Settings>({endpoint:'',model:'',apiKey:'',syncUrl:'',syncToken:''})
const bottom=ref<HTMLElement|null>(null),status=ref('本地数据库初始化中')
let controller:AbortController|null=null
const active= computed(()=>conversations.value.find(c=>c.id===activeId.value))
async function refreshConversations(){conversations.value=await listConversations()}
async function selectConversation(id:string){activeId.value=id;messages.value=await listMessages(id);await scrollBottom()}
async function scrollBottom(){await nextTick();bottom.value?.scrollIntoView({behavior:'smooth'})}
async function startConversation(){const c=await createConversation();await refreshConversations();await selectConversation(c.id)}
async function send(){
 const text=draft.value.trim();if(!text||busy.value)return
 if(!activeId.value)await startConversation()
 const conversationId=activeId.value,now=new Date().toISOString()
 const user:Message={id:newId(),conversation_id:conversationId,role:'user',content:text,status:'completed',model:null,created_at:now,updated_at:now}
 draft.value='';error.value='';messages.value.push(user)
 // Durability boundary: commit user input before any network/model request.
 await saveMessage(user)
 if(settings.value.syncUrl) void syncNow(settings.value.syncUrl,settings.value.syncToken)
 const assistant:Message={id:newId(),conversation_id:conversationId,role:'assistant',content:'',status:'pending',model:settings.value.model,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
 messages.value.push(assistant);await saveMessage(assistant,false)
 busy.value=true;controller=new AbortController();await scrollBottom()
 try{
   await updateMessage(assistant.id,'','streaming',settings.value.model);assistant.status='streaming'
   for await(const token of streamChat(settings.value.endpoint,settings.value.apiKey,settings.value.model,messages.value.filter(m=>m.id!==assistant.id),controller.signal)){
     assistant.content+=token
     await updateMessage(assistant.id,assistant.content,'streaming',settings.value.model)
     await scrollBottom()
   }
   assistant.status='completed';assistant.updated_at=await updateMessage(assistant.id,assistant.content,'completed',settings.value.model)
   await saveMessage(assistant)
   status.value='已保存到本地'
 }catch(e){
   assistant.status=controller.signal.aborted?'interrupted':'failed'
   assistant.content=assistant.content||''
   assistant.updated_at=await updateMessage(assistant.id,assistant.content,assistant.status,settings.value.model)
   await saveMessage(assistant)
   error.value=String(e);status.value='消息已保存在本地'
 }finally{busy.value=false;controller=null;await refreshConversations();await scrollBottom();if(settings.value.syncUrl)void syncNow(settings.value.syncUrl,settings.value.syncToken)}
}
async function saveConfig(){await writeSettings(settings.value);showSettings.value=false;status.value='设置已保存在本机'}
function keydown(e:KeyboardEvent){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}
onMounted(async()=>{
 try{settings.value=await readSettings();await refreshConversations();if(conversations.value.length)await selectConversation(conversations.value[0].id);else await startConversation();status.value='本地模式就绪';if(settings.value.syncUrl)void syncNow(settings.value.syncUrl,settings.value.syncToken)}
 catch(e){error.value=String(e);status.value='初始化失败'}
})
watch(activeId,async id=>{if(id)messages.value=await listMessages(id)})
</script>

<template>
<div class="shell">
 <aside class="sidebar">
  <div class="brand"><div class="brand-mark">P</div><div><strong>Personal Agent</strong><small>YOUR LOCAL AI WORKSPACE</small></div></div>
  <button class="new-chat" @click="startConversation">＋ 新建对话</button>
  <div class="section-label">最近对话</div>
  <div class="conversation-list">
   <button v-for="c in conversations" :key="c.id" class="conversation" :class="{active:activeId===c.id}" @click="selectConversation(c.id)">
    <span class="conversation-dot"></span><span>{{c.title}}</span>
   </button>
  </div>
  <div class="sidebar-bottom"><div class="local-indicator"><i></i> 本地数据已启用</div><button class="settings-button" @click="showSettings=true">⚙ 设置与模型</button></div>
 </aside>
 <main class="main">
  <header class="topbar"><div><span class="eyebrow">PRIVATE WORKSPACE</span><h1>{{active?.title||'新的对话'}}</h1></div><div class="top-status"><span class="pulse"></span>{{status}}</div></header>
  <section class="chat-scroll">
   <div v-if="!messages.length" class="welcome"><div class="orb">✳</div><h2>想做点什么？</h2><p>你的对话首先保存在这台设备上。模型只负责推理，不掌管你的历史记录。</p><div class="suggestions"><button @click="draft='帮我梳理一个复杂问题的关键步骤'">梳理复杂问题 <span>↗</span></button><button @click="draft='把我今天的想法整理成清晰的行动清单'">整理行动清单 <span>↗</span></button></div></div>
   <div v-else class="messages">
    <article v-for="m in messages" :key="m.id" class="message" :class="m.role">
     <div class="avatar">{{m.role==='user'?'我':'✳'}}</div><div class="message-body"><div class="message-meta">{{m.role==='user'?'你':'PERSONAL AGENT'}} <span v-if="m.status!=='completed'">{{m.status==='streaming'?'正在生成…':m.status==='interrupted'?'上次运行中断':m.status==='failed'?'生成失败':''}}</span></div><div class="message-content">{{m.content|| (m.status==='pending'?'等待模型…':'')}}</div></div>
    </article>
   </div>
   <div ref="bottom"></div>
  </section>
  <div v-if="error" class="error-line">{{error}}</div>
  <footer class="composer-wrap"><div class="composer"><textarea v-model="draft" placeholder="给 Personal Agent 发送消息…" rows="2" @keydown="keydown"></textarea><div class="composer-bottom"><span>Enter 发送 · Shift + Enter 换行 · 自动保存到本机</span><button class="send-button" :disabled="busy||!draft.trim()" @click="send">{{busy?'生成中':'发送 ↑'}}</button></div></div><div class="footnote">本地优先 · 你的消息历史保存在本机 SQLite</div></footer>
 </main>
 <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings=false"><section class="settings-modal"><div class="modal-heading"><div><span class="eyebrow">CONFIGURATION</span><h2>模型与同步设置</h2></div><button class="close" @click="showSettings=false">×</button></div>
  <label>OpenAI-compatible API Endpoint<input v-model="settings.endpoint" placeholder="https://api.deepseek.com/chat/completions"></label>
  <label>模型名称<input v-model="settings.model" placeholder="deepseek-chat"></label>
  <label>API Key<input v-model="settings.apiKey" type="password" placeholder="仅保存在本机设置文件（当前版本未加密）；本地 Ollama 可不填 Key"></label>
  <div class="settings-divider"></div><p class="settings-note">跨设备同步（可选）。留空时完全本地运行；配置同步服务后，将通过 HTTPS 同步消息。</p>
  <label>Sync API URL<input v-model="settings.syncUrl" placeholder="https://your-sync-service.example.com"></label>
  <label>Sync Token<input v-model="settings.syncToken" type="password" placeholder="同步服务 Bearer Token"></label>
  <div class="modal-actions"><button class="cancel" @click="showSettings=false">取消</button><button class="save" @click="saveConfig">保存设置</button></div>
 </section></div>
</div>
</template>