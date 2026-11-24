// SCTMG Data Disc server: Discord sign-in, roster sync, share links and online
// games, backed by D1. Everything else (index.html, api/v1) is served straight
// from static assets; wrangler.jsonc only routes /auth/* and /sync/* here.
//
// Bindings (wrangler.jsonc + dashboard):
//   DB                     D1 database
//   ASSETS                 static files
//   DISCORD_CLIENT_ID      var, public
//   DISCORD_CLIENT_SECRET  secret, set in the Cloudflare dashboard, never in git
//   DEV_LOGIN              "1" only in .dev.vars for local testing

import { applyOp, newGameState, other } from "./game.js";

const SESSION_COOKIE = "sdd_s";
const STATE_COOKIE = "sdd_oauth";
const SESSION_DAYS = 180;
const MAX_BODY = 256 * 1024;
const MAX_ROSTER = 64 * 1024;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

// ---------- small helpers ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (status, error) => json({ error }, status);
const now = () => Date.now();

function randomCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function getCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
function cookie(name, value, maxAge, secure) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
const isLocal = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Too large");
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Bad JSON"); }
}
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- sessions ----------
async function currentUser(req, env) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.name, u.avatar, u.discord_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires > ?"
  ).bind(await sha256(token), now()).first();
  return row || null;
}
async function startSession(env, userId, url) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 864e5).run();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400, url.protocol === "https:");
}
async function upsertUser(env, discordId, name, avatar) {
  const t = now();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE discord_id = ?").bind(discordId).first();
  if (existing) {
    await env.DB.prepare("UPDATE users SET name = ?, avatar = ?, seen = ? WHERE id = ?").bind(name, avatar, t, existing.id).run();
    return existing.id;
  }
  const id = "u_" + randomToken().slice(0, 16);
  await env.DB.prepare("INSERT INTO users (id, discord_id, name, avatar, created, seen) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, discordId, name, avatar, t, t).run();
  return id;
}
const publicUser = (u) => ({
  id: u.id, name: u.name,
  avatar: u.avatar && /^\d+$/.test(u.discord_id || "") ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=64` : null,
});

// ---------- /auth ----------
async function auth(req, env, url, path) {
  const secure = url.protocol === "https:";
  const redirectUri = `${url.origin}/auth/callback`;

  if (path === "/auth/login" && req.method === "GET") {
    if (!env.DISCORD_CLIENT_ID) return fail(503, "Discord sign-in isn't configured yet");
    const state = randomToken();
    const q = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirectUri, response_type: "code",
      scope: "identify", state, prompt: "none",
    });
    return new Response(null, {
      status: 302,
      headers: { location: `https://discord.com/oauth2/authorize?${q}`, "set-cookie": cookie(STATE_COOKIE, state, 600, secure) },
    });
  }

  if (path === "/auth/callback" && req.method === "GET") {
    const back = (msg) => new Response(null, {
      status: 302,
      headers: { location: "/#signin-error=" + encodeURIComponent(msg), "set-cookie": cookie(STATE_COOKIE, "", 0, secure) },
    });
    const state = url.searchParams.get("state");
    if (!state || state !== getCookie(req, STATE_COOKIE)) return back("Sign-in expired, please try again");
    const code = url.searchParams.get("code");
    if (!code) return back(url.searchParams.get("error") === "access_denied" ? "Sign-in was cancelled" : "Discord didn't sign you in");
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      // Discord's reply holds only an error code (e.g. invalid_client), never a
      // secret, so it's safe to log and to show. 429 = Discord rate limiting.
      const body = (await tokenRes.text()).slice(0, 300);
      console.log("discord token exchange failed", tokenRes.status, body);
      let reason = String(tokenRes.status);
      try { reason = JSON.parse(body).error || reason; } catch {}
      return back(`Discord sign-in failed (${reason})`);
    }
    const { access_token } = await tokenRes.json();
    const meRes = await fetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${access_token}` } });
    if (!meRes.ok) return back("Couldn't read your Discord profile");
    const me = await meRes.json();
    const userId = await upsertUser(env, String(me.id), String(me.global_name || me.username || "Player").slice(0, 40), me.avatar || null);
    const headers = new Headers({ location: "/#signed-in" });
    headers.append("set-cookie", await startSession(env, userId, url));
    headers.append("set-cookie", cookie(STATE_COOKIE, "", 0, secure));
    return new Response(null, { status: 302, headers });
  }

  // Local testing only: sign in as any name without Discord. Needs DEV_LOGIN=1
  // (from .dev.vars, which never ships) AND a localhost URL.
  if (path === "/auth/dev" && req.method === "GET") {
    if (env.DEV_LOGIN !== "1" || !isLocal(url)) return fail(404, "Not found");
    const name = (url.searchParams.get("name") || "Tester").slice(0, 40);
    const userId = await upsertUser(env, "dev:" + name, name, null);
    return new Response(null, { status: 302, headers: { location: "/#signed-in", "set-cookie": await startSession(env, userId, url) } });
  }

  if (path === "/auth/me" && req.method === "GET") {
    const user = await currentUser(req, env);
    return json({ user: user ? publicUser(user) : null, discord: !!env.DISCORD_CLIENT_ID || env.DEV_LOGIN === "1" });
  }

  if (path === "/auth/logout" && req.method === "POST") {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE hash = ?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", 0, secure) });
  }

  if (path === "/auth/account" && req.method === "DELETE") {
    const user = await currentUser(req, env);
    if (!user) return fail(401, "Not signed in");
    // ON DELETE CASCADE removes sessions, rosters, shares and games too.
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", 0, secure) });
  }

  return fail(404, "Not found");
}

// ---------- /sync/rosters ----------
function checkRoster(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Bad roster");
  const text = JSON.stringify(data);
  if (text.length > MAX_ROSTER) throw new HttpError(413, "Roster too large");
  return text;
}
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id);

async function rosters(req, env, user, rest) {
  if (rest === "" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, data, updated, deleted FROM rosters WHERE user_id = ?").bind(user.id).all();
    return json({ rosters: results.map((r) => ({ id: r.id, updated: r.updated, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) })) });
  }
  const id = decodeURIComponent(rest.slice(1));
  if (!validId(id)) return fail(400, "Bad roster id");
  if (req.method === "PUT") {
    const body = await readJson(req);
    const text = checkRoster(body.data);
    const updated = Number.isFinite(body.updated) ? Math.min(body.updated, now() + 60e3) : now();
    // Newest edit wins: an older copy from a stale device can't overwrite.
    await env.DB.prepare(
      `INSERT INTO rosters (user_id, id, data, updated, deleted) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated, deleted = 0
       WHERE excluded.updated >= rosters.updated`
    ).bind(user.id, id, text, updated).run();
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    const updated = Number(new URL(req.url).searchParams.get("t")) || now();
    await env.DB.prepare(
      `INSERT INTO rosters (user_id, id, data, updated, deleted) VALUES (?, ?, NULL, ?, 1)
       ON CONFLICT (user_id, id) DO UPDATE SET data = NULL, updated = excluded.updated, deleted = 1
       WHERE excluded.updated >= rosters.updated`
    ).bind(user.id, id, updated).run();
    return json({ ok: true });
  }
  return fail(405, "Method not allowed");
}

// ---------- /sync/shares ----------
async function shares(req, env, user, rest) {
  if (rest === "" && req.method === "POST") {
    if (!user) return fail(401, "Sign in to share rosters");
    const body = await readJson(req);
    const text = checkRoster(body.roster);
    for (let i = 0; i < 5; i++) {
      const code = randomCode(8);
      const r = await env.DB.prepare("INSERT OR IGNORE INTO shares (code, user_id, data, created) VALUES (?, ?, ?, ?)")
        .bind(code, user.id, text, now()).run();
      if (r.meta.changes) return json({ code });
    }
    return fail(500, "Couldn't make a share code");
  }
  if (req.method === "GET" && rest.length > 1) {
    // Public on purpose: anyone with the link can view and copy the roster.
    const code = rest.slice(1).toUpperCase();
    const row = await env.DB.prepare("SELECT s.data, s.created, u.name FROM shares s JOIN users u ON u.id = s.user_id WHERE s.code = ?").bind(code).first();
    if (!row) return fail(404, "That share link doesn't exist (or was deleted)");
    return json({ roster: JSON.parse(row.data), by: row.name, created: row.created });
  }
  return fail(405, "Method not allowed");
}

// ---------- /sync/games ----------
const sideOf = (row, user) => (row.host === user.id ? "A" : row.guest === user.id ? "B" : null);
const gameOut = (row, side) => ({ code: row.code, side, v: row.version, status: row.status, state: JSON.parse(row.state) });

function checkSide(body) {
  const { roster, units, cards } = body;
  checkRoster(roster);
  if (!Array.isArray(units) || !Array.isArray(cards) || units.length > 60 || cards.length > 40) throw new HttpError(400, "Bad army");
  return { roster, units, cards };
}

// Read-modify-write with a version check, retried if the other player wrote
// in between. D1 has no interactive transactions, so this is our lock.
async function updateGame(env, code, user, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await env.DB.prepare("SELECT * FROM games WHERE code = ?").bind(code).first();
    if (!row) throw new HttpError(404, "No game with that code");
    const out = await fn(row, JSON.parse(row.state));
    if (out.response) return out.response;
    const t = now();
    const r = await env.DB.prepare(
      "UPDATE games SET state = ?, guest = ?, status = ?, version = version + 1, updated = ? WHERE code = ? AND version = ?"
    ).bind(JSON.stringify(out.state), out.guest ?? row.guest, out.status ?? row.status, t, code, row.version).run();
    if (r.meta.changes) {
      return { ...row, state: JSON.stringify(out.state), guest: out.guest ?? row.guest, status: out.status ?? row.status, version: row.version + 1, updated: t };
    }
  }
  throw new HttpError(409, "The game is busy, try again");
}

async function games(req, env, user, url, rest) {
  // List my recent games so I can resume them on another device.
  if (rest === "" && req.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM games WHERE (host = ?1 OR guest = ?1) ORDER BY updated DESC LIMIT 10"
    ).bind(user.id).all();
    return json({
      games: results.map((row) => {
        const s = JSON.parse(row.state), side = sideOf(row, user), me = s.sides[side], opp = s.sides[other(side)];
        return { code: row.code, side, status: row.status, mission: s.mission, round: s.round, over: s.over,
          me: me && me.roster && me.roster.name, opp: opp ? opp.name : null, updated: row.updated };
      }),
    });
  }

  // Host a new game.
  if (rest === "" && req.method === "POST") {
    const body = await readJson(req);
    const side = checkSide(body);
    if (typeof body.mission !== "string" || !Number.isInteger(body.len) || body.len < 1 || body.len > 10) return fail(400, "Bad mission");
    const state = newGameState({
      mission: body.mission, deploy: typeof body.deploy === "string" ? body.deploy : "", scale: body.scale, len: body.len,
      host: { name: user.name, avatar: publicUser(user).avatar, ...side },
    });
    const t = now();
    for (let i = 0; i < 5; i++) {
      const code = randomCode(6);
      const r = await env.DB.prepare(
        "INSERT OR IGNORE INTO games (code, host, guest, status, state, version, created, updated) VALUES (?, ?, NULL, 'active', ?, 1, ?, ?)"
      ).bind(code, user.id, JSON.stringify(state), t, t).run();
      if (r.meta.changes) return json({ code, side: "A", v: 1, status: "active", state });
    }
    return fail(500, "Couldn't make a game code");
  }

  const [, rawCode, action] = rest.split("/");
  const code = (rawCode || "").toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return fail(400, "Game codes are 6 letters and numbers");

  // Join with a code.
  if (action === "join" && req.method === "POST") {
    const body = await readJson(req);
    const side = checkSide(body);
    const row = await updateGame(env, code, user, (row, s) => {
      if (row.host === user.id) return { response: fail(400, "That's your own game. Share the code with your opponent.") };
      if (row.status !== "active") return { response: fail(410, "That game has ended") };
      if (row.guest && row.guest !== user.id) return { response: fail(409, "That game already has two players") };
      if (row.guest === user.id) return { response: json(gameOut(row, "B")) }; // rejoin: keep my existing side
      s.sides.B = { name: user.name, avatar: publicUser(user).avatar, ...side, vp: 0 };
      return { state: s, guest: user.id };
    });
    return row instanceof Response ? row : json(gameOut(row, "B"));
  }

  // Poll. ?v=N returns just {same:true} when nothing changed.
  if (!action && req.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM games WHERE code = ?").bind(code).first();
    const side = row && sideOf(row, user);
    if (!row || !side) return fail(404, "No game with that code");
    if (Number(url.searchParams.get("v")) === row.version) return json({ same: true, v: row.version });
    return json(gameOut(row, side));
  }

  // Apply ops (my side, VP, Next/Back).
  if (action === "ops" && req.method === "POST") {
    const body = await readJson(req);
    if (!Array.isArray(body.ops) || body.ops.length > 20) return fail(400, "Bad ops");
    let side;
    const row = await updateGame(env, code, user, (row, s) => {
      side = sideOf(row, user);
      if (!side) return { response: fail(404, "No game with that code") };
      if (row.status !== "active") return { response: json(gameOut(row, side)) };
      for (const op of body.ops) {
        const r = applyOp(s, side, op);
        if (r.error) return { response: fail(400, r.error) };
        s = r.state;
      }
      return { state: s };
    });
    return row instanceof Response ? row : json(gameOut(row, side));
  }

  // End the game for both players.
  if (action === "end" && req.method === "POST") {
    let side;
    const row = await updateGame(env, code, user, (row, s) => {
      side = sideOf(row, user);
      if (!side) return { response: fail(404, "No game with that code") };
      return { state: s, status: "ended" };
    });
    return row instanceof Response ? row : json(gameOut(row, side));
  }

  return fail(404, "Not found");
}

// ---------- router ----------
async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  // Cross-site request protection: browsers send Origin on POST/PUT/DELETE.
  // Anything that changes data must come from this site's own pages.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin !== url.origin) return fail(403, "Cross-site request refused");
  }

  if (path.startsWith("/auth/")) return auth(req, env, url, path);

  if (path.startsWith("/sync/")) {
    const user = await currentUser(req, env);
    if (path.startsWith("/sync/shares")) return shares(req, env, user, path.slice("/sync/shares".length));
    if (!user) return fail(401, "Sign in first");
    if (path.startsWith("/sync/rosters")) return rosters(req, env, user, path.slice("/sync/rosters".length));
    if (path.startsWith("/sync/games")) return games(req, env, user, url, path.slice("/sync/games".length));
    return fail(404, "Not found");
  }

  return env.ASSETS.fetch(req);
}

export default {
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "Server error");
    }
  },
};
