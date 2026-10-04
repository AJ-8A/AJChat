const API_BASE="https://ajchat-api.study4u-aj.workers.dev";
const tokenKey="ajchat_admin_token";
const loginCard=document.getElementById("loginCard");
const dashboard=document.getElementById("dashboard");
const loginForm=document.getElementById("adminForm");
const tokenInput=document.getElementById("adminToken");
const loginStatus=document.getElementById("loginStatus");
const dashboardStatus=document.getElementById("dashboardStatus");

function setLoginStatus(text,error=false){loginStatus.textContent=text||"";loginStatus.className="status"+(error?" error":"")}
function setDashboardStatus(text,error=false){dashboardStatus.textContent=text||"";dashboardStatus.className="dashboard-status"+(error?" error":"")}
function headers(){return {Authorization:"Bearer "+(sessionStorage.getItem(tokenKey)||""),"Cache-Control":"no-store"}}
async function loadDashboard(){
  const response=await fetch(API_BASE+"/api/admin/overview",{headers:headers(),cache:"no-store"});
  let data={};try{data=await response.json()}catch{}
  if(response.status===401){sessionStorage.removeItem(tokenKey);showLogin("Admin token rejected.");return}
  if(!response.ok)throw new Error(data.error||"Dashboard request failed.");
  document.getElementById("usersStat").textContent=Number(data.stats?.users||0).toLocaleString();
  document.getElementById("messagesStat").textContent=Number(data.stats?.messages||0).toLocaleString();
  document.getElementById("friendshipsStat").textContent=Number(data.stats?.friendships||0).toLocaleString();
  document.getElementById("requestsStat").textContent=Number(data.stats?.pending_requests||0).toLocaleString();
  document.getElementById("usersTable").innerHTML=(data.recent_users||[]).map(user=>"<tr><td>"+esc(user.username)+"</td><td>"+date(user.created_at)+"</td></tr>").join("")||"<tr><td colspan='2'>No users yet.</td></tr>";
  document.getElementById("requestsTable").innerHTML=(data.recent_requests||[]).map(item=>"<tr><td>"+esc(item.sender)+"</td><td>"+esc(item.receiver)+"</td><td>"+badge(item.status)+"</td><td>"+date(item.created_at)+"</td></tr>").join("")||"<tr><td colspan='4'>No friend requests yet.</td></tr>";
  setDashboardStatus("Updated "+new Date().toLocaleTimeString());
}
function badge(status){const safe=esc(status||"unknown");return "<span class='badge "+safe+"'>"+safe+"</span>"}
function date(seconds){if(!seconds)return"—";return new Date(Number(seconds)*1000).toLocaleString([], {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
function esc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showDashboard(){loginCard.classList.add("hidden");dashboard.classList.remove("hidden");loadDashboard().catch(e=>setDashboardStatus(e.message,true))}
function showLogin(message=""){dashboard.classList.add("hidden");loginCard.classList.remove("hidden");setLoginStatus(message,Boolean(message))}
loginForm.addEventListener("submit",async event=>{
  event.preventDefault();
  const token=tokenInput.value.trim();if(!token)return;
  sessionStorage.setItem(tokenKey,token);setLoginStatus("Checking…");
  try{await loadDashboard();if(sessionStorage.getItem(tokenKey))showDashboard()}catch(error){sessionStorage.removeItem(tokenKey);setLoginStatus(error.message,true)}
});
document.getElementById("refreshButton").addEventListener("click",()=>loadDashboard().catch(e=>setDashboardStatus(e.message,true)));
document.getElementById("logoutButton").addEventListener("click",()=>{sessionStorage.removeItem(tokenKey);tokenInput.value="";showLogin("Locked.")});
if(sessionStorage.getItem(tokenKey))showDashboard();
