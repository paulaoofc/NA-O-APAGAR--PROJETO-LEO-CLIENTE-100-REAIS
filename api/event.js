/**
 * Serverless Function — Meta Conversions API (CAPI)
 * Endpoint: POST /api/event
 *
 * Variáveis de ambiente obrigatórias na Vercel:
 *   META_PIXEL_ID    → ID do Pixel (ex: 939206202180742)
 *   META_CAPI_TOKEN  → Access token do CAPI (gerado no Gerenciador de Eventos)
 */

import { createHash } from "crypto";

/* ─── helpers ─────────────────────────────────────────────── */

function sha256(value) {
  if (!value) return undefined;
  return createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

/** Normaliza telefone: remove tudo que não é dígito */
function normalizePhone(phone) {
  if (!phone) return undefined;
  return phone.replace(/\D/g, "");
}

/** Extrai primeiro e último nome */
function splitName(fullName) {
  if (!fullName) return { fn: undefined, ln: undefined };
  const parts = fullName.trim().split(/\s+/);
  return {
    fn: parts[0] || undefined,
    ln: parts.length > 1 ? parts[parts.length - 1] : undefined,
  };
}

/* ─── handler principal ───────────────────────────────────── */

export default async function handler(req, res) {
  /* CORS — necessário para o browser poder chamar este endpoint */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  /* Variáveis de ambiente */
  const PIXEL_ID = process.env.META_PIXEL_ID;
  const CAPI_TOKEN = process.env.META_CAPI_TOKEN;

  if (!PIXEL_ID || !CAPI_TOKEN) {
    console.error("Variáveis META_PIXEL_ID e/ou META_CAPI_TOKEN não definidas");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  /* Body */
  const body = req.body;

  if (!body || !body.event_name) {
    return res.status(400).json({ error: "event_name is required" });
  }

  /* Monta user_data com PII hasheada (exigido pela Meta) */
  const user = body.user || {};
  const { fn, ln } = splitName(user.name);
  const phone = normalizePhone(user.phone);

  const userData = {
    ...(user.em && { em: [sha256(user.em)] }), // email já pode vir como 'em' ou 'email'
    ...(user.email && { em: [sha256(user.email)] }),
    ...(phone && { ph: [sha256(phone)] }),
    ...(fn && { fn: [sha256(fn)] }),
    ...(ln && { ln: [sha256(ln)] }),
    ...(user.fbp && { fbp: user.fbp }),
    ...(user.fbc && { fbc: user.fbc }),
    ...(user.client_ip_address && {
      client_ip_address: user.client_ip_address,
    }),
    ...(user.client_user_agent && {
      client_user_agent: user.client_user_agent,
    }),
  };

  /* Evento para a Meta */
  const eventPayload = {
    event_name: body.event_name,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: body.event_source_url || "",
    action_source: "website",
    event_id: body.event_id || undefined,
    user_data: userData,
    ...(body.custom_data && { custom_data: body.custom_data }),
  };

  /* Chama a Graph API da Meta */
  const graphUrl = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`;

  try {
    const response = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [eventPayload],
        access_token: CAPI_TOKEN,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Meta CAPI error:", result);
      return res.status(502).json({ error: "Meta API error", detail: result });
    }

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
