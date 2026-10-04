const API_BASE = "https://ajchat-api.study4u-aj.workers.dev";
const WS_BASE = API_BASE.replace(/^http/,"ws");

const state = {
  mode: "login",
  token: localStorage.getItem("ajchat_token") || "",
  me: null,
  friends: [],
  activeFriend: null,
  socket: null,
  pollTimer: null,
  messages: []
};

const el = id => document.getElementById(id);
const toast = el("toast");
const sidebar = el("sidebar");
const chatList = el("chatList");
const messagesBox = el("messages");
const input = el("messageInput");

function escapeHTML(value){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function showToast(text){
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.t);
  showToast.t=setTimeout(()=>toast.classList.remove("show"),2200);
}

function authHeaders(json=false){
  const h={};
  if(state.token) h.Authorization="Bearer "+state.token;
  if(json) h["Content-Type"]="application/json";
  return h;
}

async function api(path,options={}){
  const response=await fetch(API_BASE+path,{
    ...options,
    headers:{...authHeaders(Boolean(options.body)),...(options.headers||{})},
    cache:"no-store"
  });
  let data={};
  try{data=await response.json()}catch{}
  if(!response.ok) throw new Error(data.error||"Request failed");
  return data;
}

function setAuthMessage(text,error=false){
  const node=el("authMessage");
  node.textContent=text||"";
  node.className="auth-message"+(error?" error":"");
}

function showAuth(show){
  el("authScreen").classList.toggle("hidden",!show);
}

function renderAuthMode(){
  const create=state.mode==="register";
  el("authSubmit").textContent=create?"Create account":"Sign in";
  el("authSwitch").textContent=create?"Already have an account? Sign in":"New here? Create an account";
  el("authPassword").autocomplete=create?"new-password":"current-password";
}

async function submitAuth(event){
  event.preventDefault();
  const username=el("authUsername").value.trim();
  const password=el("authPassword").value;
  setAuthMessage("Connecting…");
  try{
    const data=await api("/api/auth/"+state.mode,{method:"POST",body:JSON.stringify({username,password})});
    state.token=data.token;
    state.me=data.user;
    localStorage.setItem("ajchat_token",state.token);
    showAuth(false);
    await loadFriends();
    if(state.friends.length) selectFriend(state.friends[0].username);
    else renderEmptyFriends();
    setAuthMessage("");
    showToast("You're in. Find a friend to start chatting.");
  }catch(error){
    setAuthMessage(error.message,true);
  }
}

async function boot(){
  renderAuthMode();
  el("authForm").addEventListener("submit",submitAuth);
  el("authSwitch").addEventListener("click",()=>{
    state.mode=state.mode==="login"?"register":"login";
    setAuthMessage("");
    renderAuthMode();
    el("authUsername").focus();
  });
  if(!state.token){showAuth(true);return;}
  try{
    state.me=await api("/api/me");
    showAuth(false);
    await loadFriends();
  }catch{
    localStorage.removeItem("ajchat_token");
    state.token="";
    showAuth(true);
  }
}

async function loadFriends(){
  const data=await api("/api/friends");
  state.friends=data.friends||[];
  renderFriendList();
  if(state.activeFriend && !state.friends.some(f=>f.username===state.activeFriend)){
    state.activeFriend=null;
  }
  if(!state.activeFriend && state.friends.length) await selectFriend(state.friends[0].username);
  if(!state.friends.length) renderEmptyFriends();
}

function renderFriendList(){
  chatList.innerHTML="";
  state.friends.forEach((friend)=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="chat-item"+(friend.username===state.activeFriend?" active":"");
    button.innerHTML=`
      <div class="avatar">${escapeHTML(friend.initials||friend.username.slice(0,2).toUpperCase())}</div>
      <div class="chat-meta">
        <div class="chat-meta-top"><strong>${escapeHTML(friend.username)}</strong><time>${friend.last_message_time?formatTime(friend.last_message_time):""}</time></div>
        <p>${escapeHTML(friend.last_message||"Start a conversation")}</p>
      </div>
    `;
    button.addEventListener("click",()=>selectFriend(friend.username));
    chatList.appendChild(button);
  });
}

function renderEmptyFriends(){
  chatList.innerHTML='<div class="empty-friends"><strong>No friends yet.</strong><span>Tap ＋ and enter a friend\'s username.</span></div>';
  el("chatName").textContent="Your friends";
  el("chatStatus").textContent="Add someone to start";
  messagesBox.innerHTML='<div class="empty-chat"><strong>Your chat is waiting.</strong><span>Add a friend and they can message you from their own device.</span></div>';
}

function formatTime(value){
  if(!value)return "";
  return new Date(Number(value)*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}

async function selectFriend(username){
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}
  state.activeFriend=username;
  renderFriendList();
  const friend=state.friends.find(f=>f.username===username);
  el("chatAvatar").textContent=(friend?.initials||username.slice(0,2)).toUpperCase();
  el("chatName").textContent=username;
  el("chatStatus").textContent="connecting…";
  sidebar.classList.add("closed");
  try{
    const data=await api("/api/messages/"+encodeURIComponent(username));
    state.messages=data.messages||[];
    renderMessages();
    startPolling();
    connectSocket();
  }catch(error){
    showToast(error.message);
  }
}

function renderMessages(){
  messagesBox.innerHTML="";
  if(!state.messages.length){
    messagesBox.innerHTML='<div class="empty-chat"><strong>No messages yet.</strong><span>Say hello — this chat is between real people.</span></div>';
    return;
  }
  state.messages.forEach((message,index)=>{
    const mine=message.sender===state.me?.username;
    const row=document.createElement("div");
    row.className="message-row"+(mine?" me":"");
    row.style.animationDelay=(index*25)+"ms";
    row.innerHTML=`<article class="message"><div class="message-text">${escapeHTML(message.body)}</div><div class="message-meta"><time>${formatTime(message.created_at)}</time>${mine?'<span class="message-status">✓✓</span>':""}</div></article>`;
    messagesBox.appendChild(row);
  });
  messagesBox.scrollTop=messagesBox.scrollHeight;
}

function startPolling(){
  if(state.pollTimer || !state.activeFriend || !state.token) return;
  const poll=async()=>{
    if(!state.activeFriend || !state.token) return;
    try{
      const data=await api("/api/messages/"+encodeURIComponent(state.activeFriend));
      const incoming=data.messages||[];
      const known=new Set(state.messages.map(m=>String(m.id)));
      let changed=false;
      for(const message of incoming){
        if(!known.has(String(message.id))){ state.messages.push(message); changed=true; }
      }
      if(changed){
        state.messages=state.messages.slice(-100);
        renderMessages();
      }
    }catch{}
  };
  poll();
  state.pollTimer=setInterval(poll,2500);
}

function connectSocket(retry=0){
  if(!state.activeFriend||!state.token)return;
  if(state.socket){try{state.socket.close()}catch{}}
  const expectedFriend=state.activeFriend;
  const room=state.friends.find(f=>f.username===expectedFriend)?.room;
  if(!room){return}
  const socket=new WebSocket(WS_BASE+"/ws?room="+encodeURIComponent(room)+"&token="+encodeURIComponent(state.token));
  state.socket=socket;
  socket.onopen=()=>{
    if(state.socket!==socket || state.activeFriend!==expectedFriend) return;
    startPolling();
    el("chatStatus").textContent="online";
  };
  socket.onmessage=(event)=>{
    if(state.socket!==socket || state.activeFriend!==expectedFriend) return;
    try{
      const data=JSON.parse(event.data);
      if(data.type==="message" && data.message){
        if(!state.messages.some(m=>m.id===data.message.id)){
          state.messages.push(data.message);
          renderMessages();
        }
      }
      if(data.type==="presence") el("chatStatus").textContent=data.online?"online now":"offline";
    }catch{}
  };
  socket.onclose=(event)=>{
    if(state.socket!==socket || state.activeFriend!==expectedFriend) return;
    state.socket=null;
    if(document.visibilityState==="hidden") return;
    startPolling();
    el("chatStatus").textContent="offline — messages will sync";
    const delay=Math.min(1600*Math.max(1,retry+1),8000);
    setTimeout(()=>{
      if(state.activeFriend===expectedFriend && state.token) connectSocket(retry+1);
    },delay);
  };
  socket.onerror=()=>{
    if(state.socket===socket && state.activeFriend===expectedFriend){
      startPolling();
      el("chatStatus").textContent="offline — messages will sync";
    }
  };
}

async function sendMessage(){
  const text=input.value.trim();
  if(!text || !state.activeFriend)return;

  if(state.socket && state.socket.readyState===WebSocket.OPEN){
    state.socket.send(JSON.stringify({type:"message",text}));
    input.value="";
    return;
  }

  try{
    const data=await api("/api/messages/"+encodeURIComponent(state.activeFriend),{
      method:"POST",
      body:JSON.stringify({text})
    });
    if(data.message && !state.messages.some(m=>String(m.id)===String(data.message.id))){
      state.messages.push(data.message);
      state.messages=state.messages.slice(-100);
      renderMessages();
    }
    input.value="";
  }catch(error){
    showToast(error.message);
  }
}

async function addFriend(){
  if(!state.me)return;
  const username=prompt("Enter your friend's AJChat username:");
  if(!username)return;
  try{
    await api("/api/friends",{method:"POST",body:JSON.stringify({username:username.trim()})});
    await loadFriends();
    await selectFriend(username.trim().toLowerCase());
    showToast("Friend added.");
  }catch(error){
    showToast(error.message);
  }
}

el("composer").addEventListener("submit",event=>{event.preventDefault();sendMessage()});
el("newChatButton").addEventListener("click",addFriend);
el("backButton").addEventListener("click",()=>sidebar.classList.remove("closed"));
el("themeButton").addEventListener("click",()=>{
  document.body.classList.toggle("light-mode");
  showToast(document.body.classList.contains("light-mode")?"Soft light mode":"Dark glass mode");
});
el("emojiButton").addEventListener("click",()=>{input.value+=" 😊";input.focus()});
el("attachButton").addEventListener("click",()=>showToast("Media upload comes next — real chat is already live."));
el("chatSearch").addEventListener("input",event=>{
  const q=event.target.value.trim().toLowerCase();
  document.querySelectorAll(".chat-item").forEach(item=>item.classList.toggle("hidden",!item.textContent.toLowerCase().includes(q)));
});
document.addEventListener("keydown",event=>{
  if(event.key==="/" && document.activeElement.tagName!=="INPUT"){event.preventDefault();el("chatSearch").focus()}
});

boot();
