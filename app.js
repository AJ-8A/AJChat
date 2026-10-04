const chats = [
  {id:"sarah",name:"Sarah Anderson",initials:"SA",status:"online now",last:"The new glass layout looks 🔥",time:"12:42",unread:2,type:"person"},
  {id:"dev",name:"Dev Circle",initials:"DC",status:"8 members online",last:"Nikhil: shipped the API update",time:"11:58",unread:5,type:"group"},
  {id:"arjun",name:"Arjun Menon",initials:"AM",status:"last seen 8m ago",last:"Send me the project when ready.",time:"10:31",unread:0,type:"person"},
  {id:"maya",name:"Maya Joseph",initials:"MJ",status:"online now",last:"Voice note • 0:18",time:"Yesterday",unread:0,type:"person"},
  {id:"study",name:"StudyHub Team",initials:"ST",status:"14 members",last:"AJ: Leaderboard sync is live.",time:"Mon",unread:3,type:"group"}
];

const messages = {
  sarah:[
    {from:"them",text:"Hey AJ! I just checked the new Study4U interface.",time:"12:34"},
    {from:"them",text:"The transparent glass sections feel much cleaner now.",time:"12:35"},
    {from:"me",text:"Nice 😎 I added the motion system too. The whole thing should feel alive without being noisy.",time:"12:36"},
    {from:"them",text:"That is the right direction. Keep the interactions subtle.",time:"12:37"},
    {from:"them",text:"The new glass layout looks 🔥",time:"12:42"}
  ],
  dev:[
    {from:"them",text:"Global leaderboard endpoint is responding.",time:"11:54"},
    {from:"me",text:"Perfect. Next step is real-time chat.",time:"11:55"},
    {from:"them",text:"Nikhil: shipped the API update",time:"11:58"}
  ],
  arjun:[
    {from:"them",text:"Are you free this afternoon?",time:"10:28"},
    {from:"me",text:"Yep. I can review the project after lunch.",time:"10:30"},
    {from:"them",text:"Send me the project when ready.",time:"10:31"}
  ],
  maya:[
    {from:"me",text:"That demo looked great.",time:"Yesterday"},
    {from:"them",text:"Voice note • 0:18",time:"Yesterday"}
  ],
  study:[
    {from:"them",text:"Leaderboard sync is live on D1.",time:"Mon"},
    {from:"me",text:"AJ: Leaderboard sync is live.",time:"Mon"}
  ]
};

let activeChat = "sarah";
let activeFilter = "all";

const el = id => document.getElementById(id);
const list = el("chatList");
const messagesBox = el("messages");
const input = el("messageInput");
const sidebar = el("sidebar");
const toast = el("toast");

function escapeHTML(value){
  return String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

function showToast(text){
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.t);
  showToast.t = setTimeout(()=>toast.classList.remove("show"),2200);
}

function getChat(id){
  return chats.find(chat => chat.id === id);
}

function renderChatList(query=""){
  const q = query.trim().toLowerCase();
  list.innerHTML = "";
  chats
    .filter(chat => activeFilter === "all" || (activeFilter === "unread" ? chat.unread : chat.type === "group"))
    .filter(chat => !q || (chat.name+" "+chat.last).toLowerCase().includes(q))
    .forEach(chat => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-item"+(chat.id===activeChat?" active":"");
      button.innerHTML = `
        <div class="avatar">${escapeHTML(chat.initials)}</div>
        <div class="chat-meta">
          <div class="chat-meta-top">
            <strong>${escapeHTML(chat.name)}</strong>
            <time>${escapeHTML(chat.time)}</time>
          </div>
          <p>${escapeHTML(chat.last)}</p>
        </div>
        ${chat.unread ? `<span class="unread-count">${chat.unread}</span>` : ""}
      `;
      button.addEventListener("click",()=>selectChat(chat.id));
      list.appendChild(button);
    });
}

function renderMessages(){
  const chat = getChat(activeChat);
  if(!chat) return;
  el("chatAvatar").textContent = chat.initials;
  el("chatName").textContent = chat.name;
  el("chatStatus").textContent = chat.status;
  messagesBox.innerHTML = "";
  (messages[activeChat] || []).forEach((message,index)=>{
    const row = document.createElement("div");
    row.className = "message-row"+(message.from==="me"?" me":"");
    row.style.animationDelay = `${index*45}ms`;
    row.innerHTML = `
      <article class="message">
        <div class="message-text">${escapeHTML(message.text)}</div>
        <div class="message-meta">
          <time>${escapeHTML(message.time)}</time>
          ${message.from==="me" ? '<span class="message-status">✓✓</span>' : ""}
        </div>
      </article>
    `;
    messagesBox.appendChild(row);
  });
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function selectChat(id){
  activeChat = id;
  const chat = getChat(id);
  if(chat) chat.unread = 0;
  renderChatList(el("chatSearch").value);
  renderMessages();
  sidebar.classList.add("closed");
}

function addMessage(text){
  const clean = text.trim();
  if(!clean) return;
  if(!messages[activeChat]) messages[activeChat] = [];
  const now = new Date();
  const time = now.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  messages[activeChat].push({from:"me",text:clean,time});
  getChat(activeChat).last = clean;
  getChat(activeChat).time = "now";
  renderMessages();
  renderChatList(el("chatSearch").value);
  input.value = "";
  showTyping();
}

function showTyping(){
  const row = el("typingRow");
  row.classList.remove("hidden");
  setTimeout(()=>{
    row.classList.add("hidden");
    const reply = {
      sarah:"That looks clean. I like where this is going 👌",
      dev:"Nice. Let's wire the realtime layer next.",
      arjun:"Got it 👍",
      maya:"Perfect ✨",
      study:"Nice work, AJ."
    }[activeChat] || "Got it 👍";
    const chat = getChat(activeChat);
    const now = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    messages[activeChat].push({from:"them",text:reply,time:now});
    chat.last = reply;
    chat.time = "now";
    renderMessages();
    renderChatList(el("chatSearch").value);
  },1000);
}

el("composer").addEventListener("submit",event=>{
  event.preventDefault();
  addMessage(input.value);
});

el("chatSearch").addEventListener("input",event=>renderChatList(event.target.value));

document.querySelectorAll(".filter-pill").forEach(button=>{
  button.addEventListener("click",()=>{
    document.querySelectorAll(".filter-pill").forEach(x=>x.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderChatList(el("chatSearch").value);
  });
});

el("themeButton").addEventListener("click",()=>{
  document.body.classList.toggle("light-mode");
  showToast(document.body.classList.contains("light-mode") ? "Soft light mode" : "Dark glass mode");
});

el("newChatButton").addEventListener("click",()=>{
  showToast("New chat composer is ready for the realtime backend.");
});

el("emojiButton").addEventListener("click",()=>{
  input.value += " 😊";
  input.focus();
});

el("attachButton").addEventListener("click",()=>{
  showToast("Attachment support comes with the storage backend.");
});

el("backButton").addEventListener("click",()=>{
  sidebar.classList.remove("closed");
});

document.addEventListener("keydown",event=>{
  if(event.key === "/" && document.activeElement.tagName !== "INPUT"){
    event.preventDefault();
    el("chatSearch").focus();
  }
});

renderChatList();
renderMessages();
