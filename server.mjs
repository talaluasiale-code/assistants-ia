import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Mistral } from "@mistralai/mistralai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;
const MODEL = "mistral-small-latest";

const MODES = {
  general: {
    label: "Assistant général",
    system:
      "Tu es un assistant utile et concis. Réponds dans la langue de l'utilisateur.",
  },
  entretien: {
    label: "Coach d'entretien",
    system:
      "Tu es un coach professionnel spécialisé dans la préparation aux entretiens d'embauche. " +
      "Simule des entretiens réalistes en jouant le recruteur, pose une question à la fois, " +
      "puis donne un feedback structuré (points forts, axes d'amélioration, reformulation suggérée) " +
      "sur les réponses du candidat. Adapte les questions au poste décrit par l'utilisateur. " +
      "Réponds dans la langue de l'utilisateur.",
  },
  email: {
    label: "E-mails pro",
    system:
      "Tu es un rédacteur expert en communication professionnelle. Quand l'utilisateur décrit une " +
      "situation, propose un e-mail prêt à envoyer avec objet, ton adapté au destinataire, et une " +
      "variante plus formelle ou plus directe si pertinent. Reste bref, poli et sans jargon inutile. " +
      "Réponds dans la langue de l'utilisateur.",
  },
  examen: {
    label: "Tuteur de révision",
    system:
      "Tu es un tuteur pédagogique qui aide à réviser des examens. Explique les notions pas à pas, " +
      "avec des exemples concrets, puis vérifie la compréhension en posant une question de quiz courte. " +
      "Corrige les erreurs en bienveillant et adapte le niveau au profil de l'utilisateur. " +
      "Réponds dans la langue de l'utilisateur.",
  },
};
const DEFAULT_MODE = "general";
const DAILY_LIMIT = Math.max(1, parseInt(process.env.DAILY_MESSAGE_LIMIT || "10", 10) || 10);

const usageByIp = new Map();

function checkQuota(ip) {
  const today = new Date().toISOString().slice(0, 10);
  let usage = usageByIp.get(ip);
  if (!usage || usage.date !== today) {
    usage = { date: today, count: 0 };
    usageByIp.set(ip, usage);
  }
  if (usage.count >= DAILY_LIMIT) return { allowed: false, remaining: 0 };
  usage.count += 1;
  if (usageByIp.size > 10_000) {
    for (const [key, value] of usageByIp) {
      if (value.date !== today) usageByIp.delete(key);
    }
  }
  return { allowed: true, remaining: DAILY_LIMIT - usage.count };
}
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 8000;

if (!process.env.MISTRAL_API_KEY) {
  console.error("Erreur : MISTRAL_API_KEY n'est pas définie.");
  console.error("Créez un fichier .env ou exportez la variable avant de démarrer :");
  console.error("  export MISTRAL_API_KEY=\"votre-clé\" && npm start");
  process.exit(1);
}

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function sanitizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) return null;
  const messages = rawMessages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_LENGTH) }));
  return messages.length > 0 ? messages : null;
}

function refundQuota(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const usage = usageByIp.get(ip);
  if (usage && usage.date === today && usage.count > 0) usage.count -= 1;
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse(await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 100_000) reject(new Error("Corps de requête trop volumineux"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    }));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Requête invalide." }));
    return;
  }

  const messages = sanitizeMessages(body?.messages);
  if (!messages) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Aucun message valide fourni." }));
    return;
  }

  const mode = typeof body?.mode === "string" && MODES[body.mode] ? body.mode : DEFAULT_MODE;
  const quota = checkQuota(req.socket.remoteAddress || "inconnu");
  if (!quota.allowed) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Quota gratuit atteint (${DAILY_LIMIT} messages par jour). Revenez demain ou passez en premium.`,
        remaining: 0,
        limit: DAILY_LIMIT,
      }),
    );
    return;
  }

  try {
    const result = await client.chat.complete({
      model: MODEL,
      messages: [{ role: "system", content: MODES[mode].system }, ...messages],
    });

    const reply = result?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || reply.length === 0) {
      throw new Error("Réponse vide du modèle");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reply, remaining: quota.remaining, limit: DAILY_LIMIT }));
  } catch (err) {
    refundQuota(req.socket.remoteAddress || "inconnu");
    console.error("Erreur API Mistral :", err?.message || err);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "L'appel à l'API Mistral a échoué. Réessayez." }));
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/modes") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        Object.entries(MODES).map(([id, { label }]) => ({ id, label })),
      ),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const file = url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, file);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Interdit");
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 — Page introuvable");
  }
});

server.listen(PORT, () => {
  console.log(`Serveur de chat démarré sur http://localhost:${PORT}`);
  console.log(`Modèle : ${MODEL} (clé API chargée côté serveur uniquement)`);
});
