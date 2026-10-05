const API_BASE = "https://ajchat-api.study4u-aj.workers.dev";
const WS_BASE = API_BASE.replace(/^http/,"ws");

const state = {
  mode: "login",
  token: localStorage.getItem("ajchat_token") || "",
  me: null,
  friends: [],
  groups: [],
  activeFriend: null,
  activeGroup: null,
  currentFilter: "all",
  socket: null,
  pollTimer: null,
  groupPollTimer: null,
  messages: [],
  incomingRequests: [],
  outgoingRequests: [],
  presenceTimer: null,
  friendRefreshTimer: null,
  friendRequestTimer: null,
  typingTimer: null
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
    const data=await api("/api/auth/"+state.mode,{
      method:"POST",
      body:JSON.stringify({username,password})
    });

    state.token=data.token;
    state.me=data.user;
    localStorage.setItem("ajchat_token",state.token);

    showAuth(false);
    setAuthMessage("");
    showToast(state.mode==="register"?"Account created. You're in.":"You're in.");

    startPresence();
    startFriendRefresh();
    startFriendRequestRefresh();

    Promise.all([
      loadFriends(false),
      loadGroups(false),
      loadFriendRequests()
    ]).then(async()=>{
      renderFriendList();
      if(state.friends.length) await selectFriend(state.friends[0].username);
      else if(state.groups.length) await selectGroup(state.groups[0].id);
      else renderEmptyFriends();
    }).catch(()=>{
      renderFriendList();
      renderEmptyFriends();
    });
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
    startPresence();
    startFriendRefresh();
    startFriendRequestRefresh();

    Promise.all([
      loadFriends(false),
      loadGroups(false),
      loadFriendRequests()
    ]).then(async()=>{
      renderFriendList();
      if(!state.activeFriend && !state.activeGroup){
        if(state.friends.length) await selectFriend(state.friends[0].username);
        else if(state.groups.length) await selectGroup(state.groups[0].id);
        else renderEmptyFriends();
      }
    }).catch(()=>{
      renderFriendList();
      renderEmptyFriends();
    });
  }catch{
    localStorage.removeItem("ajchat_token");
    state.token="";
    showAuth(true);
  }
}

async function sendPresence(){
  if(!state.token)return;
  try{
    await api("/api/presence",{method:"POST",body:"{}"});
    const dot=el("selfStatusDot"), label=el("selfStatusText");
    if(dot){dot.classList.remove("offline");dot.classList.add("online")}
    if(label)label.textContent="Online";
  }catch{
    const dot=el("selfStatusDot"), label=el("selfStatusText");
    if(dot){dot.classList.remove("online");dot.classList.add("offline")}
    if(label)label.textContent="Offline";
  }
}

function startPresence(){
  if(state.presenceTimer || !state.token)return;
  sendPresence();
  state.presenceTimer=setInterval(sendPresence,15000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")sendPresence()},{passive:true});
}

async function refreshFriendStates(){
  if(!state.token)return;
  try{
    const [friendData, groupData] = await Promise.all([api("/api/friends"), api("/api/groups")]);
    state.friends=friendData.friends||[];
    state.groups=groupData.groups||[];
    renderFriendList();
    if(state.activeFriend){
      const active=state.friends.find(f=>f.username===state.activeFriend);
      if(active)el("chatStatus").textContent=active.online?"Online now":"Offline — messages will be saved";
    }else if(state.activeGroup){
      const active=state.groups.find(g=>Number(g.id)===Number(state.activeGroup));
      if(active)el("chatStatus").textContent=active.member_count+" members • group chat";
    }
  }catch{}
}

function startFriendRefresh(){
  if(state.friendRefreshTimer || !state.token)return;
  refreshFriendStates();
  state.friendRefreshTimer=setInterval(refreshFriendStates,10000);
}
async function loadFriends(shouldRender=true){
  const data=await api("/api/friends");
  state.friends=data.friends||[];
  if(shouldRender)renderFriendList();
  if(state.activeFriend && !state.friends.some(f=>f.username===state.activeFriend)){
    state.activeFriend=null;
  }
  if(!state.friends.length && !state.groups.length) renderEmptyFriends();
}

async function loadGroups(shouldRender=true){
  try{
    const data=await api("/api/groups");
    state.groups=data.groups||[];
  }catch{
    state.groups=[];
  }
  if(shouldRender)renderFriendList();
  if(state.activeGroup && !state.groups.some(g=>Number(g.id)===Number(state.activeGroup))){
    state.activeGroup=null;
  }
}

function showChatItem(button){
  chatList.appendChild(button);
}

function renderFriendList(){
  chatList.innerHTML="";
  const filter=state.currentFilter;
  const friends=state.friends.filter(friend => {
    if(filter==="groups") return false;
    if(filter==="unread") return Number(friend.unread_count||0)>0;
    return true;
  });
  const groups=state.groups.filter(group => filter!=="unread" && filter==="groups" || filter==="all");

  friends.forEach(friend=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="chat-item"+(friend.username===state.activeFriend?" active":"");
    const presenceClass=friend.online?"online":"offline";
    const presenceText=friend.online?"Online":"Offline";
    const unread=Number(friend.unread_count||0);
    const avatar=escapeHTML(friend.initials||friend.username.slice(0,2).toUpperCase());
    const name=escapeHTML(friend.username);
    const last=friend.last_message?" · "+escapeHTML(friend.last_message):"";
    const time=friend.last_message_time?formatTime(friend.last_message_time):"";
    const badge=unread?"<span class=\"unread-count\">"+(unread>99?"99+":unread)+"</span>":"";
    button.innerHTML="<div class=\"avatar\">"+avatar+"</div>"+
      "<div class=\"chat-meta\"><div class=\"chat-meta-top\"><strong>"+name+"</strong><time>"+time+"</time></div>"+
      "<p><span class=\"friend-presence "+presenceClass+"><i></i>"+presenceText+"</span>"+last+"</p></div>"+badge;
    button.addEventListener("click",()=>selectFriend(friend.username));
    showChatItem(button);
  });

  groups.forEach(group=>{
    const button=document.createElement("button");
    button.type="button";
    button.className="chat-item group-chat-item"+(Number(group.id)===Number(state.activeGroup)?" active":"");
    const avatar=escapeHTML(group.initials||group.name.slice(0,2).toUpperCase());
    const name=escapeHTML(group.name);
    const last=group.last_message?" · "+escapeHTML(group.last_message):"";
    const time=group.last_message_time?formatTime(group.last_message_time):"";
    button.innerHTML="<div class=\"avatar group-avatar\">"+avatar+"</div>"+
      "<div class=\"chat-meta\"><div class=\"chat-meta-top\"><strong>"+name+"</strong><time>"+time+"</time></div>"+
      "<p><span class=\"group-presence\"><i></i>"+Number(group.member_count||0)+" members</span>"+last+"</p></div>";
    button.addEventListener("click",()=>selectGroup(group.id));
    showChatItem(button);
  });

  if(!chatList.children.length && (state.friends.length||state.groups.length)){
    chatList.innerHTML='<div class="empty-friends"><strong>No chats in this filter.</strong><span>Switch back to All to see your conversations.</span></div>';
  }
}
function startFriendRequestRefresh(){
  if(state.friendRequestTimer || !state.token)return;
  state.friendRequestTimer=setInterval(loadFriendRequests,10000);
}

async function loadFriendRequests(){
  try{
    const data=await api("/api/friend-requests");
    state.incomingRequests=data.incoming||[];
    state.outgoingRequests=data.outgoing||[];
    renderFriendRequests();
  }catch{}
}

function renderFriendRequests(){
  const section=el("friendRequestsSection");
  const list=el("requestList");
  const count=el("requestCount");
  if(!section||!list||!count)return;
  const incoming=state.incomingRequests||[];
  section.hidden=incoming.length===0;
  count.textContent=incoming.length===1?"1 waiting":incoming.length+" waiting";
  list.innerHTML="";
  incoming.forEach(request=>{
    const card=document.createElement("article");
    card.className="friend-request-card";
    card.innerHTML="<div class=\"avatar request-avatar\">"+escapeHTML(request.initials||request.username.slice(0,2).toUpperCase())+"</div>"+
      "<div class=\"request-copy\"><strong>"+escapeHTML(request.username)+"</strong><span>wants to be your friend</span></div>"+
      "<div class=\"request-actions\"><button type=\"button\" class=\"request-button accept\">✓</button><button type=\"button\" class=\"request-button reject\">×</button></div>";
    const buttons=card.querySelectorAll("button");
    buttons[0].addEventListener("click",()=>handleFriendRequest(request.id,"accept"));
    buttons[1].addEventListener("click",()=>handleFriendRequest(request.id,"reject"));
    list.appendChild(card);
  });
}

async function handleFriendRequest(requestId,action){
  try{
    await api("/api/friend-requests/"+requestId+"/"+action,{method:"POST"});
    await loadFriendRequests();
    await loadFriends();
    showToast(action==="accept"?"Friend request accepted.":"Friend request declined.");
  }catch(error){showToast(error.message);}
}
function renderEmptyFriends(){
  chatList.innerHTML='<div class="empty-friends"><strong>No friends yet.</strong><span>Tap ＋ and enter a friend\'s username.</span></div>';
  el("chatName").textContent="Your friends";
  el("chatStatus").textContent="Add someone to start";
  messagesBox.innerHTML='<div class="empty-chat"><strong>Your chat is waiting.</strong><span>Add a friend and they can message you from their own device.</span></div>';
}

function renderTyping(show, username=state.activeFriend){
  const row=el("typingRow");
  const avatar=el("typingRow")?.querySelector(".typing-avatar");
  if(!row)return;
  row.classList.toggle("hidden",!show);
  if(show){
    if(avatar)avatar.textContent=(username||"??").slice(0,2).toUpperCase();
    el("chatStatus").textContent=(username||"Friend")+" is typing…";
  }else if(state.activeFriend){
    const active=state.friends.find(f=>f.username===state.activeFriend);
    if(active)el("chatStatus").textContent=active.online?"Online now":"Offline — messages will be saved";
  }
}

function sendTypingState(typing){
  if(state.socket && state.socket.readyState===WebSocket.OPEN && state.activeFriend){
    try{state.socket.send(JSON.stringify({type:"typing",typing:Boolean(typing)}))}catch{}
  }
}

function formatTime(value){
  if(!value)return "";
  return new Date(Number(value)*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}

async function selectFriend(username){
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}
  if(state.groupPollTimer){clearInterval(state.groupPollTimer);state.groupPollTimer=null;}
  if(state.socket){try{state.socket.close()}catch{}}
  state.activeGroup=null;
  state.activeFriend=username;
  renderTyping(false, username);
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
    await api("/api/messages/"+encodeURIComponent(username)+"/read",{method:"POST",body:"{}"}).catch(()=>{});
    const active=state.friends.find(f=>f.username===username);
    if(active)active.unread_count=0;
    renderFriendList();
    startPolling();
    connectSocket();
  }catch(error){
    showToast(error.message);
  }
}

async function selectGroup(groupId){
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}
  if(state.groupPollTimer){clearInterval(state.groupPollTimer);state.groupPollTimer=null;}
  if(state.socket){try{state.socket.close()}catch{} state.socket=null;}
  state.activeFriend=null;
  state.activeGroup=Number(groupId);
  renderFriendList();

  const group=state.groups.find(g=>Number(g.id)===Number(groupId));
  if(!group)return;

  el("chatAvatar").textContent=(group.initials||group.name.slice(0,2)).toUpperCase();
  el("chatName").textContent=group.name;
  el("chatStatus").textContent=Number(group.member_count||0)+" members • group chat";
  sidebar.classList.add("closed");

  try{
    const data=await api("/api/groups/"+group.id+"/messages");
    state.messages=data.messages||[];
    renderMessages();
    startGroupPolling();
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

function startGroupPolling(){
  if(state.groupPollTimer || !state.activeGroup || !state.token) return;
  const poll=async()=>{
    if(!state.activeGroup || !state.token)return;
    try{
      const data=await api("/api/groups/"+state.activeGroup+"/messages");
      const incoming=data.messages||[];
      const known=new Set(state.messages.map(m=>String(m.id)));
      let changed=false;
      for(const message of incoming){
        if(!known.has(String(message.id))){state.messages.push(message);changed=true;}
      }
      if(changed){
        state.messages=state.messages.slice(-100);
        renderMessages();
      }
    }catch{}
  };
  poll();
  state.groupPollTimer=setInterval(poll,2500);
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
      if(data.type==="typing"){
        renderTyping(Boolean(data.typing), data.username || expectedFriend);
      }
      if(data.type==="message" && data.message){
        renderTyping(false, expectedFriend);
        if(!state.messages.some(m=>String(m.id)===String(data.message.id))){
          state.messages.push(data.message);
          renderMessages();
        }
      }
      if(data.type==="ready"){
        el("chatStatus").textContent=data.online
          ?"Online now"
          :"Offline — messages will be saved";
      }
      if(data.type==="presence"){
        el("chatStatus").textContent=data.online
          ?"Online now"
          :"Offline — messages will be saved";
      }
    }catch{}
  };
  socket.onclose=(event)=>{
    if(state.socket!==socket || state.activeFriend!==expectedFriend) return;
    state.socket=null;
    renderTyping(false, expectedFriend);
    if(document.visibilityState==="hidden") return;
    startPolling();
    el("chatStatus").textContent="Offline — messages will be saved";
    const delay=Math.min(1600*Math.max(1,retry+1),8000);
    setTimeout(()=>{
      if(state.activeFriend===expectedFriend && state.token) connectSocket(retry+1);
    },delay);
  };
  socket.onerror=()=>{
    if(state.socket===socket && state.activeFriend===expectedFriend){
      startPolling();
      el("chatStatus").textContent="Offline — messages will be saved";
    }
  };
}

async function sendMessage(){
  const text=input.value.trim();
  if(!text || (!state.activeFriend && !state.activeGroup))return;
  clearTimeout(state.typingTimer);
  state.typingTimer=null;
  sendTypingState(false);

  if(state.activeGroup){
    input.disabled=true;
    try{
      const data=await api("/api/groups/"+state.activeGroup+"/messages",{method:"POST",body:JSON.stringify({text})});
      if(data.message && !state.messages.some(m=>String(m.id)===String(data.message.id))){
        state.messages.push(data.message);
        state.messages=state.messages.slice(-100);
        renderMessages();
      }
      input.value="";
      input.focus();
      el("chatStatus").textContent="sent to group";
    }catch(error){
      showToast(error.message);
    }finally{
      input.disabled=false;
      input.focus();
    }
    return;
  }

  const friend=state.activeFriend;
  input.disabled=true;
  try{
    const data=await api("/api/messages/"+encodeURIComponent(friend),{
      method:"POST",
      body:JSON.stringify({text})
    });

    if(data.message && !state.messages.some(m=>String(m.id)===String(data.message.id))){
      state.messages.push(data.message);
      state.messages=state.messages.slice(-100);
      renderMessages();
    }

    input.value="";
    input.focus();

    if(state.socket && state.socket.readyState===WebSocket.OPEN){
      el("chatStatus").textContent="sent";
      setTimeout(()=>{
        if(state.activeFriend===friend && state.socket?.readyState===WebSocket.OPEN){
          el("chatStatus").textContent="online";
        }
      },900);
    }else{
      startPolling();
      el("chatStatus").textContent="Offline — saved & will deliver";
    }
  }catch(error){
    showToast(error.message);
  }finally{
    input.disabled=false;
    input.focus();
  }
}

async function createGroup(){
  if(!state.me)return;
  const name=prompt("Group name:");
  if(!name || name.trim().length<2)return;
  const members=prompt("Friend usernames, separated by commas:");
  if(!members)return;
  const usernames=members.split(",").map(v=>v.trim()).filter(Boolean);
  if(!usernames.length)return;
  try{
    const data=await api("/api/groups",{method:"POST",body:JSON.stringify({name:name.trim(),usernames})});
    await loadGroups();
    await selectGroup(data.group.id);
    showToast("Group created.");
  }catch(error){
    showToast(error.message);
  }
}

async function addFriend(){
  if(!state.me)return;
  const username=prompt("Enter your friend's AJChat username:");
  if(!username)return;
  try{
    const data=await api("/api/friends",{method:"POST",body:JSON.stringify({username:username.trim()})});
    if(data.status==="friends"){
      await loadFriends();
      await selectFriend(username.trim().toLowerCase());
      showToast("You are already friends.");
      return;
    }
    if(data.status==="incoming"){
      await loadFriendRequests();
      showToast("They already sent you a request. Check Friend requests.");
      return;
    }
    await loadFriendRequests();
    showToast("Friend request sent.");
  }catch(error){
    showToast(error.message);
  }
}

el("composer").addEventListener("submit",event=>{event.preventDefault();sendMessage()});
el("newChatButton").addEventListener("click",addFriend);
el("newGroupButton")?.addEventListener("click",createGroup);
el("backButton").addEventListener("click",()=>sidebar.classList.remove("closed"));
el("themeButton").addEventListener("click",()=>{
  document.body.classList.toggle("light-mode");
  showToast(document.body.classList.contains("light-mode")?"Soft light mode":"Dark glass mode");
});
el("emojiButton").addEventListener("click",()=>{input.value+=" 😊";input.focus()});input.addEventListener("input",()=>{
  if(state.activeGroup || !state.activeFriend)return;
  const typing=input.value.trim().length>0;
  sendTypingState(typing);
  clearTimeout(state.typingTimer);
  if(typing){
    state.typingTimer=setTimeout(()=>{
      sendTypingState(false);
      state.typingTimer=null;
    },1400);
  }
});
input.addEventListener("blur",()=>{
  clearTimeout(state.typingTimer);
  state.typingTimer=null;
  sendTypingState(false);
});

el("attachButton").addEventListener("click",()=>showToast("Media upload comes next — real chat is already live."));
document.querySelectorAll(".filter-pill").forEach(button=>{
  button.addEventListener("click",()=>{
    document.querySelectorAll(".filter-pill").forEach(item=>item.classList.remove("active"));
    button.classList.add("active");
    state.currentFilter=button.dataset.filter||"all";
    renderFriendList();
  });
});
el("chatSearch").addEventListener("input",event=>{
  const q=event.target.value.trim().toLowerCase();
  document.querySelectorAll(".chat-item").forEach(item=>item.classList.toggle("hidden",!item.textContent.toLowerCase().includes(q)));
});
document.addEventListener("keydown",event=>{
  if(event.key==="/" && document.activeElement.tagName!=="INPUT"){event.preventDefault();el("chatSearch").focus()}
});

boot();
