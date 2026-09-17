/** Webhook local Evolution → confirma SIM/NÃO. Porta 8091. */
import http from "node:http";
const U = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const K = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const E = (process.env.EVOLUTION_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const EK = process.env.EVOLUTION_API_KEY || "";
const P = Number(process.env.CONFIRM_WEBHOOK_PORT || 8091);
const F = (process.env.CONFIRM_WEBHOOK_FORWARD_URL || "").replace(/\/$/, "");
if (!U || !K || !EK) { console.error("faltam env"); process.exit(1); }
const R = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const N = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function cls(s) {
  const t = N(s);
  if (!t) return null;
  if (["1", "s", "si", "sim", "yes", "y", "ok", "okay", "confirmo", "confirmado"].includes(t)) return "yes";
  if (["2", "n", "nao", "no", "cancelar", "cancela", "desmarcar"].includes(t)) return "no";
  return /^(sim|si|yes)\b/.test(t) || /^1$/.test(t) ? "yes" : /^(nao|no)\b/.test(t) || /^2$/.test(t) ? "no" : null;
}
function txt(m) {
  const n = R(m);
  const p = [n.conversation, R(n.extendedTextMessage).text];
  for (const w of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "editedMessage"]) {
    const i = R(R(n[w]).message);
    p.push(i.conversation, R(i.extendedTextMessage).text);
  }
  return p.filter((x) => typeof x === "string" && x.trim()).join(" ");
}
async function sb(path, o = {}) {
  const h = { apikey: K, Authorization: `Bearer ${K}`, Accept: "application/json" };
  if (o.body !== undefined) { h["Content-Type"] = "application/json"; h.Prefer = "return=representation"; }
  const r = await fetch(`${U}/rest/v1/${path}`, { method: o.method || "GET", headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`SB ${r.status} ${t.slice(0, 120)}`);
  return t ? JSON.parse(t) : null;
}
async function evo(method, path, body) {
  const r = await fetch(`${E}${path}`, { method, headers: { apikey: EK, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`EVO ${r.status}`);
  return j;
}
function fmt(iso, p) {
  const d = new Date(iso);
  return p === "d" ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}
function msgs(body) {
  const root = R(body), data = root.data ?? root, out = [];
  if (Array.isArray(data)) out.push(...data);
  else if (data && typeof data === "object") Array.isArray(data.messages) ? out.push(...data.messages) : out.push(data);
  if (Array.isArray(root.messages)) out.push(...root.messages);
  return out.filter((m) => m && (m.key || m.message));
}
function digs(phone) {
  const raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return [];
  const b = raw.startsWith("55") && raw.length >= 12 ? raw.slice(2) : raw;
  const L = new Set([b]);
  if (b.length === 11 && b[2] === "9") L.add(b.slice(0, 2) + b.slice(3));
  if (b.length === 10) L.add(b.slice(0, 2) + "9" + b.slice(2));
  const o = new Set();
  for (const x of L) { o.add(x); o.add("55" + x); }
  return [...o];
}
async function handle(body) {
  const instName = String(body.instance || R(body.data).instance || "").trim();
  const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();
  const rows = await sb(`appointments?select=id,tenant_id,starts_at,confirmation_sent_at,patients!inner(id,full_name,phone,address)&status=in.(PENDING_CONFIRMATION,SCHEDULED)&confirmation_sent_at=not.is.null&confirmation_sent_at=gte.${since}&ends_at=gte.${now}&order=confirmation_sent_at.desc&limit=20`);
  if (!rows?.length) return 0;
  const tids = [...new Set(rows.map((r) => r.tenant_id))];
  const was = await sb(`whatsapp_configs?tenant_id=in.(${tids.join(",")})&select=tenant_id,instance_name`);
  const waBy = new Map((was || []).map((w) => [w.tenant_id, w]));
  let n = 0;
  for (const raw of msgs(body)) {
    const key = R(raw.key);
    if (key.fromMe === true || key.fromMe === "true") continue;
    const remote = String(key.remoteJid || "");
    if (!remote || remote.includes("@g.us")) continue;
    const intent = cls(txt(raw.message || raw));
    if (!intent) continue;
    console.log("inbound", intent, remote);
    for (const row of rows) {
      const wa = waBy.get(row.tenant_id);
      if (!wa?.instance_name || (instName && wa.instance_name !== instName)) continue;
      const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
      const addr = R(patient?.address);
      const lid = typeof addr.whatsappLid === "string" ? addr.whatsappLid : "";
      const pc = digs(patient?.phone);
      const rd = remote.replace(/\D/g, "");
      let ok = (remote.includes("@lid") && lid === remote) || pc.some((p) => rd && (p.endsWith(rd.slice(-10)) || rd.endsWith(p.slice(-10))));
      if (!ok && remote.includes("@lid") && rows.filter((r) => r.tenant_id === row.tenant_id).length === 1) ok = true;
      if (!ok) continue;
      if (remote.includes("@lid") && lid !== remote) {
        try { await sb(`patients?id=eq.${patient.id}`, { method: "PATCH", body: { address: { ...addr, whatsappLid: remote } } }); } catch {}
      }
      const when = `${fmt(row.starts_at, "d")} às ${fmt(row.starts_at, "t")}`;
      const first = String(patient?.full_name || "oi").split(" ")[0];
      const phone = String(patient?.phone || "").replace(/\D/g, "");
      const number = phone.startsWith("55") ? phone : phone.length <= 11 ? `55${phone}` : phone;
      if (intent === "yes") {
        const upd = await sb(`appointments?id=eq.${row.id}&status=in.(SCHEDULED,PENDING_CONFIRMATION)`, { method: "PATCH", body: { status: "CONFIRMED", confirmed_at: new Date().toISOString() } });
        if (!upd?.length) continue;
        try { await evo("POST", `/message/sendText/${encodeURIComponent(wa.instance_name)}`, { number, text: `${first}, consulta confirmada para ${when}. Até lá!`, delay: 400, linkPreview: false }); } catch (e) { console.warn(e.message); }
        console.log("CONFIRMED", row.id); n++; return n;
      }
      const upd = await sb(`appointments?id=eq.${row.id}&status=in.(SCHEDULED,PENDING_CONFIRMATION,CONFIRMED)`, { method: "PATCH", body: { status: "CANCELLED", cancelled_at: new Date().toISOString(), cancel_reason: "Paciente respondeu NÃO no WhatsApp" } });
      if (!upd?.length) continue;
      try { await evo("POST", `/message/sendText/${encodeURIComponent(wa.instance_name)}`, { number, text: `${first}, cancelamos sua consulta de ${when}. Se quiser remarcar, fale com a recepção.`, delay: 400, linkPreview: false }); } catch (e) { console.warn(e.message); }
      console.log("CANCELLED", row.id); n++; return n;
    }
  }
  return n;
}
http.createServer(async (req, res) => {
  if (req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"received":true}');
  if (F) fetch(F, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw }).catch(() => {});
  try {
    const ev = String(body.event || body.type || "");
    if (/messag/i.test(ev) || msgs(body).length) {
      const n = await handle(body);
      console.log(n ? `applied ${n}` : `no-match ${ev || "msg"}`);
    }
  } catch (e) { console.error(e.message || e); }
}).listen(P, "127.0.0.1", () => console.log(`clivya-confirm-webhook :${P}`));
