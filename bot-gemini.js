const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// =============================================
// 🔧 SETTINGS — YAHAN FILL KAREIN
// =============================================
const CONFIG = {
  VERIFY_TOKEN: "subscloud_final_v4",
  WHATSAPP_TOKEN: "EAAVY8ms3ZCdoBRWDRpknOBjmamKQyMlX2VQ4GtZAvrWt7q2VwWvMllvGTaK06FyH9m2RsYxCljGycdZBoSCDmtyVqBR08GaaGeIbwWrWk3ZBmYsxoj0xHobfjqZCpXoxD6yo8VORZBW2j4vx3M540jx0zZB6Tij7M301aNEfhJyQedjsvoJRl6DD35OhAvZCtgTT3AZDZD",  // Meta se
  PHONE_NUMBER_ID: "1126092713916770",     // Meta se
  GEMINI_API_KEY: "AIzaSyAqLosLCrApzZ5ZbtRskbe4KYGowdKte4w",       // aistudio.google.com se (FREE)
  OWNER_NUMBER: "923116014450",                // Aapka number (92 + number)
  BUSINESS_NAME: "Macrotoolz",
};

// Gemini API URL
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

// =============================================
// DATABASE
// =============================================
let DB = {
  customers: [],
  subscriptions: [],
  payments: [],
  promises: [],
  blocked: [],
  suspended: [],
  interests: [],
  noRecordNumbers: [],
  catalog: [
    {
      name: "Adobe Creative Cloud", icon: "🎨",
      plans: [
        { name: "Enterprise", price: 800, type: "enterprise", stability: "risky",
          features: ["All Adobe apps", "100GB Cloud", "AI Features"],
          issues: "Week mein 1-2x logout/suspension possible. 24hr fix guaranteed." },
        { name: "Individual", price: 1500, type: "individual", stability: "stable",
          features: ["All Adobe apps", "100GB Cloud", "AI Features"],
          issues: "Fully stable. Koi issue nahi." }
      ]
    },
    {
      name: "ChatGPT Plus", icon: "🤖",
      plans: [{ name: "Individual", price: 1200, type: "individual", stability: "stable",
        features: ["GPT-4o", "Image generation", "No limits", "All plugins"],
        issues: "Stable. Koi masla nahi." }]
    },
    {
      name: "Veo3", icon: "🎬",
      plans: [{ name: "Individual", price: 2000, type: "individual", stability: "stable",
        features: ["AI Video generation", "4K quality", "Google DeepMind"],
        issues: "Naya tool, stable hai." }]
    },
    {
      name: "CapCut Pro", icon: "✂️",
      plans: [{ name: "Individual", price: 600, type: "individual", stability: "stable",
        features: ["All Pro features", "No watermark", "AI tools"],
        issues: "Stable. Koi issue nahi." }]
    }
  ],
  resolution: {
    "Adobe Enterprise": "2 hours",
    "Adobe Individual": "30 minutes",
    "ChatGPT Plus": "15 minutes",
    "Veo3": "1 hour",
    "CapCut Pro": "20 minutes"
  }
};

// =============================================
// SESSIONS & SPAM TRACKING
// =============================================
const sessions = {};
const spamTracker = {};

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      history: [],
      warnCount: 0,
      tempBlocked: false,
      blockUntil: null,
      lastActivity: Date.now()
    };
  }
  sessions[phone].lastActivity = Date.now();
  return sessions[phone];
}

// Clean old sessions every hour
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach(k => {
    if (now - sessions[k].lastActivity > 86400000) delete sessions[k];
  });
}, 3600000);

// =============================================
// SPAM DETECTION
// =============================================
const SPAM_WINDOW = 15000;
const SPAM_LIMIT = 3;
const WARN_LIMIT = 2;
const BLOCK_DURATION = 30000;

function checkSpam(phone) {
  const now = Date.now();
  if (!spamTracker[phone]) spamTracker[phone] = [];
  spamTracker[phone] = spamTracker[phone].filter(t => now - t < SPAM_WINDOW);
  spamTracker[phone].push(now);
  const session = getSession(phone);

  if (session.tempBlocked && session.blockUntil > now) {
    const remaining = Math.ceil((session.blockUntil - now) / 1000);
    return { blocked: true, reason: "still", remaining };
  } else if (session.tempBlocked) {
    session.tempBlocked = false;
    session.warnCount = 0;
  }

  if (spamTracker[phone].length > SPAM_LIMIT) {
    session.warnCount++;
    if (session.warnCount >= WARN_LIMIT) {
      session.tempBlocked = true;
      session.blockUntil = now + BLOCK_DURATION;
      return { blocked: true, reason: "newblock", remaining: 30 };
    }
    return { blocked: false, warn: true, warnCount: session.warnCount, remaining: WARN_LIMIT - session.warnCount };
  }
  return { blocked: false };
}

function isBlocked(phone) {
  return DB.blocked.some(b => b.wa.replace(/\D/g, "") === phone);
}

function isSuspended(phone) {
  const sus = DB.suspended.find(s => s.wa.replace(/\D/g, "") === phone);
  if (!sus) return false;
  if (sus.until && new Date(sus.until) < new Date()) return false;
  return true;
}

function getCustByPhone(phone) {
  return DB.customers.find(c => c.wa.replace(/\D/g, "") === phone);
}

function getCustByEmail(email) {
  return DB.customers.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());
}

// =============================================
// BUILD CATALOG
// =============================================
function buildCatalog() {
  let text = "";
  DB.catalog.forEach(tool => {
    text += `\n${tool.icon} ${tool.name}:\n`;
    tool.plans.forEach(plan => {
      const res = DB.resolution[`${tool.name} ${plan.name}`] || DB.resolution[tool.name] || "1 hour";
      text += `  • ${plan.name}: PKR ${plan.price.toLocaleString()}/month\n`;
      text += `    ${plan.stability === "stable" ? "✅ Stable" : "⚠️ Has Issues"} | Support: ${res}\n`;
      text += `    Note: ${plan.issues}\n`;
    });
  });
  return text;
}

// =============================================
// EMAIL SUBSCRIPTION CHECK
// =============================================
function checkSubByEmail(email) {
  const cust = getCustByEmail(email);
  if (!cust) return null;
  const subs = DB.subscriptions.filter(s => s.custId === cust.id && s.status === "active");
  return { customer: cust, subscriptions: subs };
}

// =============================================
// AUTO RENEWAL CHECKER
// =============================================
async function checkRenewals() {
  console.log("🔄 Checking renewals...");
  const today = new Date();

  for (const sub of DB.subscriptions.filter(s => s.status === "active")) {
    const exp = new Date(sub.expiry);
    const daysLeft = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
    const cust = DB.customers.find(c => c.id === sub.custId);
    if (!cust) continue;

    if ([3, 1, 0].includes(daysLeft)) {
      const msg = `⏰ *Renewal Reminder*\n\n📦 ${sub.tool} — ${sub.plan}\n${daysLeft === 0 ? "Aaj expire ho rahi hai! ❌" : `${daysLeft} din mein expire hogi ⚠️`}\n\n💰 Renewal: PKR ${sub.price.toLocaleString()}/month\n\nRenew karein! ✅\n_${CONFIG.BUSINESS_NAME}_`;
      await sendMsg(cust.wa.replace(/\D/g, ""), msg);
      console.log(`✅ Renewal reminder → ${cust.name} (${daysLeft}d left)`);
    }
  }

  for (const promise of DB.promises.filter(p => !p.done)) {
    const daysLeft = Math.ceil((new Date(promise.date) - today) / (1000 * 60 * 60 * 24));
    const cust = DB.customers.find(c => c.id === promise.custId);
    if (!cust || ![1, 0].includes(daysLeft)) continue;
    const msg = `🤝 *Payment Reminder*\n\nAapne payment ka waada kiya tha:\n💰 PKR ${promise.amount.toLocaleString()}\n📅 Date: ${promise.date}\n📦 For: ${promise.forItem}\n\nPlease payment bhejein! 🙏\n_${CONFIG.BUSINESS_NAME}_`;
    await sendMsg(cust.wa.replace(/\D/g, ""), msg);
    await sendMsg(CONFIG.OWNER_NUMBER, `🔔 Promise Due!\n${cust.name} → PKR ${promise.amount.toLocaleString()} → ${promise.forItem}`);
  }
}

setInterval(checkRenewals, 24 * 60 * 60 * 1000);
setTimeout(checkRenewals, 5000);

// =============================================
// GEMINI AI RESPONSE (FREE)
// =============================================
async function getAIResponse(phone, userMessage, fromVoice = false) {
  const session = getSession(phone);
  const cust = getCustByPhone(phone);

  // Email check
  const emailMatch = userMessage.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    const result = checkSubByEmail(emailMatch[0]);
    if (result && result.subscriptions.length > 0) {
      const sub = result.subscriptions[0];
      const daysLeft = Math.ceil((new Date(sub.expiry) - new Date()) / (1000 * 60 * 60 * 24));
      const res = DB.resolution[`${sub.tool} ${sub.plan}`] || "1 hour";
      return `✅ *Subscription Active!*\n\n👤 ${result.customer.name}\n📦 ${sub.tool} — ${sub.plan}\n📅 Expires: ${sub.expiry}\n⏳ ${daysLeft} din baqi\n💰 PKR ${sub.price.toLocaleString()}/month\n⏱️ Support response: ${res}\n\nKoi masla ho toh batayein! 🙏`;
    }
    return `❌ Email *${emailMatch[0]}* hamare system mein nahi mili.\nSahi email likhein ya WhatsApp number confirm karein.`;
  }

  // Build conversation history for Gemini
  // Gemini uses "parts" format
  const systemPrompt = `You are ${CONFIG.BUSINESS_NAME} ka WhatsApp AI customer support bot. Pakistan mein digital subscriptions bechne wali company hai.

LANGUAGE RULE: Customer ki language match karo exactly.
- Roman Urdu → Roman Urdu mein jawab do
- English → English mein jawab do
- SHORT replies — 4-5 lines max (WhatsApp style)
- Emojis zaroor use karo
${fromVoice ? "- Customer ne VOICE MESSAGE bheja — samjho aur TEXT mein jawab do" : ""}

PRODUCTS:
${buildCatalog()}

PAYMENT: EasyPaisa | JazzCash | Bank Transfer
DELIVERY: Same day ⚡

CUSTOMER: ${cust ? `${cust.name} (${cust.email})` : "New customer"}

KAAM:
1. Products aur prices batana
2. Orders lena (naam + tool + plan collect karo)
3. Email se subscription check karna
4. Complaints handle karna (resolution time batana)
5. Payment promises note karna
6. Interests track karna

SPECIAL TAGS (reply mein likhna jab zaroorat ho):
[ORDER: name=X, tool=Y, plan=Z, price=A]
[COMPLAINT: tool=X, issue=Y, priority=high/medium/low]
[PROMISE: amount=X, date=YYYY-MM-DD, for=Z]
[INTEREST: tool=X]

RULES:
- Adobe Enterprise ke issues honest batao
- Resolution time zaroor batao complaints pe
- Har reply ke end mein ek action step`;

  // Build messages for Gemini
  const messages = [];

  // Add history (last 10 messages)
  const recentHistory = session.history.slice(-10);
  recentHistory.forEach(h => {
    messages.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }]
    });
  });

  // Add current message
  messages.push({
    role: "user",
    parts: [{ text: fromVoice ? `[Voice Message]: ${userMessage}` : userMessage }]
  });

  try {
    const response = await axios.post(GEMINI_URL, {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: messages,
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.7,
      }
    });

    const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "Maafi chahte hain, thodi technical issue hai. Dobara try karein 🙏";

    // Save to history
    session.history.push({ role: "user", content: fromVoice ? `[Voice]: ${userMessage}` : userMessage });
    session.history.push({ role: "assistant", content: reply });
    if (session.history.length > 20) session.history = session.history.slice(-20);

    // Parse actions
    await parseActions(reply, phone, cust);

    // Remove action tags from reply
    return reply.replace(/\[(ORDER|COMPLAINT|PROMISE|INTEREST):[^\]]+\]/gi, "").trim();

  } catch (err) {
    console.error("Gemini Error:", err.response?.data || err.message);
    return "Maafi chahte hain, thodi technical issue hai. Thodi der mein dobara try karein 🙏";
  }
}

// =============================================
// PARSE AI ACTIONS
// =============================================
async function parseActions(text, phone, cust) {
  const today = new Date().toISOString().split("T")[0];

  // ORDER
  const orderMatch = text.match(/\[ORDER:\s*name=([^,]+),\s*tool=([^,]+),\s*plan=([^,]+),\s*price=([^\]]+)\]/i);
  if (orderMatch) {
    const [, name, tool, plan, priceStr] = orderMatch;
    const price = parseInt(priceStr.replace(/\D/g, ""));
    if (!cust) {
      DB.noRecordNumbers.push({ wa: phone, name: name.trim(), tool: tool.trim(), added: today });
    } else {
      const exp = new Date(); exp.setMonth(exp.getMonth() + 1);
      DB.subscriptions.push({ id: Date.now(), custId: cust.id, tool: tool.trim(), plan: plan.trim(), price, months: 1, start: today, expiry: exp.toISOString().split("T")[0], status: "pending", paymethod: "pending" });
    }
    await sendMsg(CONFIG.OWNER_NUMBER, `🛒 *NEW ORDER!*\n\n👤 ${name.trim()} (+${phone})\n📦 ${tool.trim()} — ${plan.trim()}\n💰 PKR ${price.toLocaleString()}\n\n_${CONFIG.BUSINESS_NAME} Bot_`);
  }

  // COMPLAINT
  const compMatch = text.match(/\[COMPLAINT:\s*tool=([^,]+),\s*issue=([^,]+),\s*priority=([^\]]+)\]/i);
  if (compMatch) {
    await sendMsg(CONFIG.OWNER_NUMBER, `🚨 *COMPLAINT!*\n\n👤 ${cust?.name || phone}\n🔧 ${compMatch[1].trim()}\n❗ ${compMatch[2].trim()}\n⚡ ${compMatch[3].trim()}\n\n_${CONFIG.BUSINESS_NAME}_`);
  }

  // PROMISE
  const promMatch = text.match(/\[PROMISE:\s*amount=([^,]+),\s*date=([^,]+),\s*for=([^\]]+)\]/i);
  if (promMatch && cust) {
    DB.promises.push({ id: Date.now(), custId: cust.id, amount: parseInt(promMatch[1].replace(/\D/g, "")), date: promMatch[2].trim(), forItem: promMatch[3].trim(), notes: "Via Bot", done: false, added: today });
  }

  // INTEREST
  const intMatch = text.match(/\[INTEREST:\s*tool=([^\]]+)\]/i);
  if (intMatch && cust) {
    const tool = intMatch[1].trim();
    const existing = DB.interests.find(i => i.custId === cust.id && i.tool === tool);
    if (existing) { existing.count++; existing.lastDate = today; }
    else DB.interests.push({ id: Date.now(), custId: cust.id, tool, count: 1, lastDate: today, status: "prospect", notes: "" });
  }
}

// =============================================
// SEND WHATSAPP MESSAGE
// =============================================
async function sendMsg(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Send Error:", err.response?.data || err.message);
  }
}

// =============================================
// WEBHOOK
// =============================================
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === CONFIG.VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(req.query["hub.challenge"]);
  } else res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const phone = msg.from;
  let userText = "";
  let fromVoice = false;

  if (msg.type === "text") {
    userText = msg.text.body;
  } else if (msg.type === "audio") {
    fromVoice = true;
    userText = "Customer ne voice message bheja hai.";
    console.log(`🎙️ Voice message from +${phone}`);
  } else if (msg.type === "image") {
    await sendMsg(phone, "✅ Aapki payment slip receive ho gayi! Hum verify karke activate kar denge. 🙏");
    await sendMsg(CONFIG.OWNER_NUMBER, `📎 Payment Slip received from +${phone}! Verify karein.`);
    return res.sendStatus(200);
  } else {
    return res.sendStatus(200);
  }

  console.log(`📩 [+${phone}] ${fromVoice ? "🎙️" : "💬"}: ${userText}`);

  // BLOCKED CHECK
  if (isBlocked(phone)) {
    await sendMsg(phone, "🚫 Aapka account block hai. Admin se contact karein.");
    return res.sendStatus(200);
  }

  // SUSPENDED CHECK
  if (isSuspended(phone)) {
    await sendMsg(phone, "⏸️ Aapka account suspend hai. Admin se contact karein.");
    return res.sendStatus(200);
  }

  // SPAM CHECK
  const spam = checkSpam(phone);
  if (spam.blocked) {
    if (spam.reason === "newblock") {
      await sendMsg(phone, `🚫 Bahut zyada messages! ${spam.remaining}s ke liye temporarily block. Dobara try karein.`);
      await sendMsg(CONFIG.OWNER_NUMBER, `⚠️ Spam: +${phone} temp blocked`);
    } else {
      await sendMsg(phone, `⏳ ${spam.remaining}s wait karein.`);
    }
    return res.sendStatus(200);
  }

  if (spam.warn) {
    await sendMsg(phone, `⚠️ Warning ${spam.warnCount}/${WARN_LIMIT}: Bahut zyada messages! ${spam.remaining} aur warning baad block hoga.`);
  }

  // No record customer
  const cust = getCustByPhone(phone);
  if (!cust && !DB.noRecordNumbers.find(n => n.wa === phone)) {
    DB.noRecordNumbers.push({ wa: phone, added: new Date().toISOString().split("T")[0] });
    await sendMsg(CONFIG.OWNER_NUMBER, `📱 New unknown number: +${phone}\nAdmin panel mein add karein!`);
  }

  const reply = await getAIResponse(phone, userText, fromVoice);
  await sendMsg(phone, reply);
  res.sendStatus(200);
});

// =============================================
// API ENDPOINTS
// =============================================
app.get("/api/stats", (req, res) => res.json({
  customers: DB.customers.length,
  activeSubscriptions: DB.subscriptions.filter(s => s.status === "active").length,
  pendingPayments: DB.payments.filter(p => p.status === "pending").length,
  openPromises: DB.promises.filter(p => !p.done).length,
  blocked: DB.blocked.length,
  suspended: DB.suspended.length,
  noRecord: DB.noRecordNumbers.length,
  revenue: DB.payments.filter(p => p.status === "received").reduce((a, p) => a + p.amount, 0)
}));

app.get("/api/db", (req, res) => res.json(DB));
app.post("/api/catalog", (req, res) => { if (req.body.catalog) { DB.catalog = req.body.catalog; res.json({ ok: true }); } else res.status(400).json({ error: "Invalid" }); });

// =============================================
// SERVER
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   SubsCloud Bot 🚀 ONLINE — Gemini AI FREE!  ║
╠══════════════════════════════════════════════╣
║  Port    : ${PORT}                              ║
║  AI      : Google Gemini 1.5 Flash (FREE)   ║
║  Webhook : /webhook                          ║
╠══════════════════════════════════════════════╣
║  ✅ AI Chat (Urdu + English)                 ║
║  ✅ Voice Message Support                    ║
║  ✅ Smart Spam Detection                     ║
║  ✅ Block + Suspend System                   ║
║  ✅ Auto Renewal Reminders                   ║
║  ✅ Payment Promise Tracker                  ║
║  ✅ Email Subscription Check                 ║
║  ✅ Owner Notifications                      ║
║  💰 API Cost: ZERO (Gemini Free Tier)        ║
╚══════════════════════════════════════════════╝
  `);
});
