import { DurableObject } from "cloudflare:workers";

const enc = new TextEncoder();

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = origin === "https://aj-8a.github.io" || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://aj-8a.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
  };
}

function json(request, data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

function cleanUsername(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 24)
    : "";
}

function cleanMessage(value) {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function roomFor(a, b) {
  const ids = [Number(a), Number(b)].sort((x, y) => x - y);
  return `dm:${ids[0]}:${ids[1]}`;
}

function hex(bytes) {
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return hex(data);
}

async function hashPassword(password, saltBytes = null) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `${hex(salt)}:${hex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, expected] = String(stored || "").split(":");
  if (!saltHex || !expected) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(x => parseInt(x, 16)));
  const actual = await hashPassword(password, salt);
  return constantTime(actual.split(":")[1], expected);
}

function constantTime(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function authUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const row = await env.AJCHAT_DB
    .prepare(`
      SELECT u.id, u.username
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `)
    .bind(token, now)
    .first();

  return row || null;
}

function initials(username) {
  return String(username || "").slice(0, 2).toUpperCase();
}

async function isFriend(db, userId, friendId) {
  return Boolean(await db
    .prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?")
    .bind(userId, friendId)
    .first());
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json(request, { ok: true, service: "AJChat API" });
      }

      if (url.pathname === "/api/version" && request.method === "GET") {
        return json(request, { ok: true, version: "messages-v2", build: "2026-10-04" });
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await bodyJson(request);
        const username = cleanUsername(body.username);
        const password = typeof body.password === "string" ? body.password : "";

        if (username.length < 3) {
          return json(request, { error: "Username must be at least 3 characters." }, 400);
        }
        if (password.length < 8) {
          return json(request, { error: "Password must be at least 8 characters." }, 400);
        }

        const existing = await env.AJCHAT_DB
          .prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
          .bind(username)
          .first();

        if (existing) {
          return json(request, { error: "That username is already taken." }, 409);
        }

        const passwordHash = await hashPassword(password);
        const inserted = await env.AJCHAT_DB
          .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
          .bind(username, passwordHash)
          .run();

        const userId = inserted.meta?.last_row_id;
        const token = randomToken();
        const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

        await env.AJCHAT_DB
          .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(token, userId, expires)
          .run();

        return json(request, { token, user: { id: userId, username, initials: initials(username) } }, 201);
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await bodyJson(request);
        const username = cleanUsername(body.username);
        const password = typeof body.password === "string" ? body.password : "";

        const user = await env.AJCHAT_DB
          .prepare("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE")
          .bind(username)
          .first();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return json(request, { error: "Incorrect username or password." }, 401);
        }

        const token = randomToken();
        const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

        await env.AJCHAT_DB
          .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(token, user.id, expires)
          .run();

        return json(request, {
          token,
          user: { id: user.id, username: user.username, initials: initials(user.username) }
        });
      }

      if (url.pathname === "/ws" && request.method === "GET" && request.headers.get("Upgrade") === "websocket") {
        const token = url.searchParams.get("token") || "";
        const room = url.searchParams.get("room") || "";
        if (!token || !room) return new Response("Missing credentials", { status: 400 });

        const sessionRequest = new Request(request.url, {
          headers: { Authorization: "Bearer " + token }
        });
        const wsUser = await authUser(sessionRequest, env);
        if (!wsUser) return new Response("Unauthorized", { status: 401 });

        const parts = room.split(":");
        if (parts.length !== 3 || parts[0] !== "dm") return new Response("Invalid room", { status: 400 });
        const a = Number(parts[1]);
        const b = Number(parts[2]);
        if (![a, b].includes(Number(wsUser.id))) return new Response("Forbidden", { status: 403 });

        const otherId = Number(wsUser.id) === a ? b : a;
        if (!(await isFriend(env.AJCHAT_DB, wsUser.id, otherId))) {
          return new Response("Not friends", { status: 403 });
        }

        const objectId = env.CHAT_ROOMS.idFromName(room);
        const stub = env.CHAT_ROOMS.get(objectId);
        const headers = new Headers(request.headers);
        headers.set("x-ajchat-user-id", String(wsUser.id));
        headers.set("x-ajchat-username", wsUser.username);
        return stub.fetch(new Request(request, { headers }));
      }

      const user = await authUser(request, env);

      if (url.pathname === "/api/me" && request.method === "GET") {
        if (!user) return json(request, { error: "Unauthorized" }, 401);
        return json(request, { id: user.id, username: user.username, initials: initials(user.username) });
      }

      if (!user) {
        return json(request, { error: "Authentication required." }, 401);
      }

      if (url.pathname === "/api/friends" && request.method === "GET") {
        const rows = await env.AJCHAT_DB
          .prepare(`
            SELECT
              u.username,
              u.id AS user_id,
              substr(upper(u.username), 1, 2) AS initials,
              (
                SELECT body FROM messages m
                WHERE m.room_id = CASE
                  WHEN ? < u.id THEN 'dm:' || ? || ':' || u.id
                  ELSE 'dm:' || u.id || ':' || ?
                END
                ORDER BY m.id DESC LIMIT 1
              ) AS last_message,
              (
                SELECT created_at FROM messages m
                WHERE m.room_id = CASE
                  WHEN ? < u.id THEN 'dm:' || ? || ':' || u.id
                  ELSE 'dm:' || u.id || ':' || ?
                END
                ORDER BY m.id DESC LIMIT 1
              ) AS last_message_time
            FROM friendships f
            JOIN users u ON u.id = f.friend_id
            WHERE f.user_id = ?
            ORDER BY COALESCE(last_message_time, 0) DESC, u.username COLLATE NOCASE
          `)
          .bind(user.id,user.id,user.id,user.id,user.id,user.id,user.id)
          .all();

        const friends = (rows.results || []).map(friend => ({
          ...friend,
          room: roomFor(user.id, friend.user_id)
        }));

        return json(request, { friends });
      }

      if (url.pathname === "/api/friends" && request.method === "POST") {
        const body = await bodyJson(request);
        const friendUsername = cleanUsername(body.username);

        if (!friendUsername) return json(request, { error: "Enter a valid username." }, 400);
        if (friendUsername === user.username.toLowerCase()) {
          return json(request, { error: "You cannot add yourself." }, 400);
        }

        const friend = await env.AJCHAT_DB
          .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
          .bind(friendUsername)
          .first();

        if (!friend) return json(request, { error: "No AJChat user found with that username." }, 404);

        if (await isFriend(env.AJCHAT_DB, user.id, friend.id)) {
          return json(request, { ok: true, status: "friends", friend: { username: friend.username, room: roomFor(user.id, friend.id) } });
        }

        const existing = await env.AJCHAT_DB
          .prepare("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE sender_id = ? AND receiver_id = ?")
          .bind(user.id, friend.id)
          .first();

        if (existing?.status === "pending") {
          return json(request, { ok: true, status: "pending", request_id: existing.id });
        }

        const reverse = await env.AJCHAT_DB
          .prepare("SELECT id, status FROM friend_requests WHERE sender_id = ? AND receiver_id = ?")
          .bind(friend.id, user.id)
          .first();

        if (reverse?.status === "pending") {
          return json(request, { ok: true, status: "incoming", request_id: reverse.id });
        }

        let requestId;
        if (existing) {
          await env.AJCHAT_DB
            .prepare("UPDATE friend_requests SET status = 'pending', updated_at = unixepoch() WHERE id = ?")
            .bind(existing.id)
            .run();
          requestId = existing.id;
        } else {
          const inserted = await env.AJCHAT_DB
            .prepare("INSERT INTO friend_requests (sender_id, receiver_id, status) VALUES (?, ?, 'pending')")
            .bind(user.id, friend.id)
            .run();
          requestId = Number(inserted.meta?.last_row_id || 0);
        }

        return json(request, { ok: true, status: "pending", request_id: requestId, to: friend.username }, 201);
      }

      if (url.pathname === "/api/friend-requests" && request.method === "GET") {
        const incoming = await env.AJCHAT_DB.prepare(`
          SELECT r.id, r.created_at, u.username, u.id AS user_id,
                 substr(upper(u.username), 1, 2) AS initials
          FROM friend_requests r
          JOIN users u ON u.id = r.sender_id
          WHERE r.receiver_id = ? AND r.status = 'pending'
          ORDER BY r.created_at DESC
        `).bind(user.id).all();

        const outgoing = await env.AJCHAT_DB.prepare(`
          SELECT r.id, r.created_at, u.username, u.id AS user_id,
                 substr(upper(u.username), 1, 2) AS initials
          FROM friend_requests r
          JOIN users u ON u.id = r.receiver_id
          WHERE r.sender_id = ? AND r.status = 'pending'
          ORDER BY r.created_at DESC
        `).bind(user.id).all();

        return json(request, {
          incoming: incoming.results || [],
          outgoing: outgoing.results || []
        });
      }

      const requestActionMatch = url.pathname.match(/^\/api\/friend-requests\/(\d+)\/(accept|reject)$/);
      if (requestActionMatch && request.method === "POST") {
        const requestId = Number(requestActionMatch[1]);
        const action = requestActionMatch[2];

        const friendRequest = await env.AJCHAT_DB
          .prepare("SELECT id, sender_id, receiver_id, status FROM friend_requests WHERE id = ? AND receiver_id = ? AND status = 'pending'")
          .bind(requestId, user.id)
          .first();

        if (!friendRequest) {
          return json(request, { error: "Friend request not found or already handled." }, 404);
        }

        if (action === "reject") {
          await env.AJCHAT_DB
            .prepare("UPDATE friend_requests SET status = 'rejected', updated_at = unixepoch() WHERE id = ?")
            .bind(requestId)
            .run();
          return json(request, { ok: true, status: "rejected" });
        }

        await env.AJCHAT_DB.batch([
          env.AJCHAT_DB.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = unixepoch() WHERE id = ?").bind(requestId),
          env.AJCHAT_DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)").bind(user.id, friendRequest.sender_id),
          env.AJCHAT_DB.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)").bind(friendRequest.sender_id, user.id)
        ]);

        const acceptedFriend = await env.AJCHAT_DB
          .prepare("SELECT id, username FROM users WHERE id = ?")
          .bind(friendRequest.sender_id)
          .first();

        return json(request, {
          ok: true,
          status: "accepted",
          friend: acceptedFriend ? { username: acceptedFriend.username, room: roomFor(user.id, acceptedFriend.id) } : null
        });
      }

      const messageMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
      if (messageMatch && request.method === "POST") {
        const username = decodeURIComponent(messageMatch[1]);
        const friend = await env.AJCHAT_DB
          .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
          .bind(username)
          .first();

        if (!friend || !(await isFriend(env.AJCHAT_DB, user.id, friend.id))) {
          return json(request, { error: "Friend not found." }, 404);
        }

        const body = await bodyJson(request);
        const messageBody = cleanMessage(body.text);
        if (!messageBody) return json(request, { error: "Message cannot be empty." }, 400);

        const room = roomFor(user.id, friend.id);
        const inserted = await env.AJCHAT_DB
          .prepare("INSERT INTO messages (room_id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)")
          .bind(room, user.id, friend.id, messageBody)
          .run();

        const message = {
          id: Number(inserted.meta?.last_row_id || 0),
          body: messageBody,
          created_at: Math.floor(Date.now() / 1000),
          sender: user.username
        };

        return json(request, { message }, 201);
      }

      if (messageMatch && request.method === "GET") {
        const username = decodeURIComponent(messageMatch[1]);
        const friend = await env.AJCHAT_DB
          .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
          .bind(username)
          .first();

        if (!friend || !(await isFriend(env.AJCHAT_DB, user.id, friend.id))) {
          return json(request, { error: "Friend not found." }, 404);
        }

        const room = roomFor(user.id, friend.id);
        const rows = await env.AJCHAT_DB
          .prepare(`
            SELECT m.id, m.body, m.created_at, sender.username AS sender
            FROM messages m
            JOIN users sender ON sender.id = m.sender_id
            WHERE m.room_id = ?
            ORDER BY m.id DESC
            LIMIT 100
          `)
          .bind(room)
          .all();

        return json(request, { messages: (rows.results || []).reverse() });
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        const header = request.headers.get("Authorization") || "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        if (token) await env.AJCHAT_DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        return json(request, { ok: true });
      }

      return json(request, { error: "Not found" }, 404);
    } catch (error) {
      return json(request, { error: error?.message || "Server error" }, 500);
    }
  }
};

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const userId = Number(request.headers.get("x-ajchat-user-id"));
    const username = request.headers.get("x-ajchat-username") || "";
    const room = new URL(request.url).searchParams.get("room") || "";
    if (!userId || !username || !room) return new Response("Unauthorized", { status: 401 });

    const pair = room.split(":").slice(1).map(Number);
    if (pair.length !== 2 || !pair.includes(userId)) return new Response("Forbidden", { status: 403 });

    const webSocketPair = new WebSocketPair();
    const client = webSocketPair[0];
    const server = webSocketPair[1];

    this.ctx.acceptWebSocket(server, [String(userId)]);
    server.serializeAttachment({ userId, username, room });

    const online = this.ctx.getWebSockets().some(ws => {
      const attachment = ws.deserializeAttachment();
      return attachment && Number(attachment.userId) !== userId;
    });

    server.send(JSON.stringify({ type: "ready", room, online }));
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== server && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "presence", online: true }));
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.deserializeAttachment();
    if (!attachment) return;

    let data;
    try { data = JSON.parse(message); } catch { return; }

    if (data?.type !== "message") return;

    const body = cleanMessage(data.text);
    if (!body) return;

    const [a, b] = attachment.room.split(":").slice(1).map(Number);
    const recipientId = a === Number(attachment.userId) ? b : a;

    const inserted = await this.env.AJCHAT_DB
      .prepare("INSERT INTO messages (room_id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)")
      .bind(attachment.room, attachment.userId, recipientId, body)
      .run();

    const id = Number(inserted.meta?.last_row_id || 0);
    const createdAt = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      type: "message",
      message: {
        id,
        body,
        sender: attachment.username,
        created_at: createdAt
      }
    });

    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();
    if (!attachment) return;

    const stillOnline = this.ctx.getWebSockets().some(other => {
      if (other === ws) return false;
      const item = other.deserializeAttachment();
      return item && Number(item.userId) === Number(attachment.userId);
    });

    if (!stillOnline) {
      for (const socket of this.ctx.getWebSockets()) {
        if (socket !== ws && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "presence", online: false }));
        }
      }
    }
  }
}
