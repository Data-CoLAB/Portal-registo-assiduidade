import express from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Resend } from "resend";
import nodemailer from "nodemailer";
import webpush from "web-push";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ override: true });

// Ensure user-provided Gemini API key is active
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = "AQ.Ab8RN6IPIq8FCuR6t5KF9UFh6ShHY12SH-gY4xSfxddF0Hy66A";
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Configure Web Push VAPID keys
let vapidPublicKey = (process.env.VAPID_PUBLIC_KEY || "").trim();
let vapidPrivateKey = (process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = (process.env.VAPID_SUBJECT || "mailto:suporte@datacolab.pt").trim();

if (!vapidPublicKey || !vapidPrivateKey) {
  // Generate consistent ephemeral keys if not set in environment
  const generated = webpush.generateVAPIDKeys();
  vapidPublicKey = generated.publicKey;
  vapidPrivateKey = generated.privateKey;
  console.log("[WebPush] Chaves VAPID inicializadas para a sessão do servidor.");
}

try {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  console.log("[WebPush] Serviço Web Push configurado com sucesso.");
} catch (vapidErr) {
  console.error("[WebPush] Erro ao configurar VAPID:", vapidErr);
}

// Normalize host helper (e.g., mail.datacolab -> mail.datacolab.pt)
function normalizeHost(inputHost?: string): string {
  if (!inputHost) return "";
  let h = inputHost.trim().toLowerCase();
  // Remove protocol prefixes if user mistakenly typed https:// or smtp://
  h = h.replace(/^(https?:\/\/|smtp:\/\/|smtps:\/\/)/, "");
  // Remove trailing slashes or ports
  h = h.replace(/\/.*$/, "").replace(/:\d+$/, "");
  
  if (h === "mail.datacolab" || h === "smtp.datacolab" || h === "datacolab") {
    return `${h}.pt`;
  }
  return h;
}

// Relógio Oficial e Sincronização de Hora (Fuso Horário de Portugal: Europe/Lisbon)
app.get("/api/time", (req, res) => {
  const now = new Date();
  res.json({
    epoch: now.getTime(),
    iso: now.toISOString(),
    timeZone: "Europe/Lisbon",
    formattedTime: now.toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon" }),
    formattedDate: now.toLocaleDateString("pt-PT", {
      timeZone: "Europe/Lisbon",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    status: "synchronized",
  });
});

// SMTP Test Endpoint
app.post("/api/smtp/test", async (req, res) => {
  try {
    const { 
      host: rawHost, 
      port, 
      secure, 
      username, 
      password, 
      senderName, 
      senderEmail, 
      to, 
      subject, 
      html, 
      text 
    } = req.body;

    const host = normalizeHost(rawHost);

    if (!host || !port || !username || !password || !senderEmail || !to) {
      return res.status(400).json({
        success: false,
        error: "Todos os campos obrigatórios (Servidor Host, Porta, Utilizador, Senha, Remetente e Destinatário de Teste) devem ser preenchidos."
      });
    }

    const portNum = Number(port) || 587;
    const isSecure = secure === true || portNum === 465;

    console.log(`[SMTP Test Initiated]: Host=${host}, Port=${portNum}, Secure=${isSecure}, User=${username}, To=${to}`);

    const transporter = nodemailer.createTransport({
      host: host,
      port: portNum,
      secure: isSecure,
      auth: {
        user: username.trim(),
        pass: password.trim(),
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: "TLSv1.2"
      },
      connectionTimeout: 12000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    // 1. Verify connection handshake
    await transporter.verify();

    // 2. Send test email
    const fromHeader = senderName ? `"${senderName.trim()}" <${senderEmail.trim()}>` : senderEmail.trim();
    
    const info = await transporter.sendMail({
      from: fromHeader,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || `[Teste SMTP] Validação de Envio - ${host}`,
      html: html || `<p>Este é um email de teste enviado com sucesso via SMTP do servidor <strong>${host}</strong>.</p>`,
      text: text || "Email de teste enviado com sucesso via SMTP.",
    });

    console.log("[SMTP Test Success]: Message ID:", info.messageId);
    return res.json({
      success: true,
      provider: "smtp",
      messageId: info.messageId,
      response: info.response,
      normalizedHost: host,
      message: `Email de teste enviado com sucesso para ${to} através do servidor SMTP ${host}:${portNum}!`
    });
  } catch (err: any) {
    console.error("[SMTP Test Error]:", err);
    let advice = "";
    const msg = (err.message || "").toLowerCase();
    const code = err.code || "";

    if (code === "ENOTFOUND" || msg.includes("enotfound") || msg.includes("getaddrinfo")) {
      advice = "O endereço do Servidor Host não existe ou está incompleto. Se pretendia usar o servidor da Data CoLAB, utilize 'mail.datacolab.pt' ou 'smtp.office365.com'.";
    } else if (msg.includes("eauth") || msg.includes("invalid login") || msg.includes("535") || msg.includes("password not accepted") || msg.includes("authentication data")) {
      advice = "Credenciais Inválidas (Erro 535): 1) Certifique-se de que o 'Utilizador' é o email completo (ex: noreply1@datacolab.pt). 2) Verifique se a palavra-passe não contém espaços adicionais. 3) Se o servidor for cPanel/Mail Server, experimente alternar entre Porta 465 (SSL) e Porta 587 (STARTTLS). 4) Se a conta tiver 2FA ou Office 365, utilize uma 'Palavra-passe de Aplicação' (App Password).";
    } else if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || msg.includes("timed out") || msg.includes("econnrefused")) {
      advice = "Tempo limite de ligação esgotado. Verifique se o servidor aceita ligações na porta indicada (use porta 465 com SSL ativado, ou porta 587 com STARTTLS).";
    } else if (msg.includes("certificate") || msg.includes("self signed")) {
      advice = "Aviso de certificado TLS/SSL na conexão SMTP.";
    }

    return res.json({
      success: false,
      provider: "smtp",
      error: err.message || "Erro desconhecido ao conectar ao servidor SMTP.",
      code: err.code,
      advice,
    });
  }
});

// Cache global de credenciais SMTP persistidas
let globalServerSmtpConfig: any = null;

// Obter estado atual da configuração global SMTP no servidor
app.get("/api/smtp/config", (req, res) => {
  res.json({
    success: true,
    configured: Boolean(globalServerSmtpConfig && globalServerSmtpConfig.enabled),
    config: globalServerSmtpConfig ? {
      ...globalServerSmtpConfig,
      password: globalServerSmtpConfig.password ? "••••••••" : "",
    } : null,
  });
});

// Gravar/Sincronizar configuração global SMTP no servidor (substitui chaves individuais)
app.post("/api/smtp/config", (req, res) => {
  const { host, port, secure, username, password, senderName, senderEmail, replyToEmail, domain, enabled } = req.body || {};
  globalServerSmtpConfig = {
    host: host ? normalizeHost(host) : "",
    port: Number(port) || 587,
    secure: secure === true || Number(port) === 465,
    username: username ? String(username).trim() : "",
    password: password ? String(password).trim() : (globalServerSmtpConfig?.password || ""),
    senderName: senderName || "Data CoLAB - Recursos Humanos",
    senderEmail: senderEmail || username || "rh@datacolab.pt",
    replyToEmail: replyToEmail || senderEmail || "contacto@datacolab.pt",
    domain: domain || "datacolab.pt",
    enabled: enabled !== false,
    updatedAt: new Date().toISOString(),
  };

  console.log(`[SMTP Global Config Updated]: Host=${globalServerSmtpConfig.host}, Port=${globalServerSmtpConfig.port}, User=${globalServerSmtpConfig.username}, Enabled=${globalServerSmtpConfig.enabled}`);

  res.json({
    success: true,
    message: "Configuração global de SMTP sincronizada com sucesso no servidor Data CoLAB.",
    config: {
      ...globalServerSmtpConfig,
      password: globalServerSmtpConfig.password ? "••••••••" : "",
    }
  });
});

// General Email sending endpoint (supports Custom SMTP or Resend API fallback)
app.post("/api/send-email", async (req, res) => {
  try {
    const { to, subject, html, text, attachments, smtp, smtpConfig } = req.body;

    if (!to || !subject) {
      return res.status(400).json({ success: false, error: "Parâmetros 'to' e 'subject' são obrigatórios." });
    }

    // Suporte para validações automatizadas e testes em modo simulação (Dry Run) sem envio real de correio
    if (req.body.dryRun === true || to === 'test-dry-run@datacolab.pt') {
      return res.json({
        success: true,
        provider: "dry-run",
        id: `dry-run-${Date.now()}`,
        message: "Email validado com sucesso em modo de simulação (Dry Run) sem envio para caixas de correio reais."
      });
    }

    const activeSmtp = smtp || smtpConfig || globalServerSmtpConfig;

    // If SMTP is explicitly configured and enabled, use Nodemailer
    if (activeSmtp && activeSmtp.enabled && activeSmtp.host && activeSmtp.username && activeSmtp.password) {
      try {
        const host = normalizeHost(activeSmtp.host);
        const portNum = Number(activeSmtp.port) || 587;
        const isSecure = activeSmtp.secure === true || portNum === 465;

        const transporter = nodemailer.createTransport({
          host: host,
          port: portNum,
          secure: isSecure,
          auth: {
            user: activeSmtp.username.trim(),
            pass: activeSmtp.password.trim(),
          },
          tls: {
            rejectUnauthorized: false,
            minVersion: "TLSv1.2"
          },
          connectionTimeout: 12000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });

        const senderName = activeSmtp.senderName || "Data CoLAB - Recursos Humanos";
        const senderEmail = activeSmtp.senderEmail || activeSmtp.username;
        const fromHeader = `"${senderName.trim()}" <${senderEmail.trim()}>`;

        const mailOptions: any = {
          from: fromHeader,
          to: Array.isArray(to) ? to.join(', ') : to,
          subject,
          html: html || `<p>${text}</p>`,
          text,
          headers: {
            'X-Priority': '1',
            'Importance': 'high',
            'Priority': 'urgent',
            'X-Mailer': 'Data CoLAB Portal RH',
            'X-Auto-Response-Suppress': 'All',
            'Auto-Submitted': 'auto-generated',
            'X-Entity-Ref-ID': `datacolab-rh-${Date.now()}`,
          },
        };

        if (activeSmtp.replyToEmail) {
          mailOptions.replyTo = activeSmtp.replyToEmail;
        }

        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          mailOptions.attachments = attachments.map((att: any) => ({
            filename: att.filename || 'anexo.pdf',
            content: typeof att.content === 'string' ? Buffer.from(att.content, 'utf-8') : att.content,
          }));
        }

        const info = await transporter.sendMail(mailOptions);
        console.log("[SMTP Send Success]: ID:", info.messageId);
        return res.json({
          success: true,
          provider: "smtp",
          id: info.messageId,
          message: `Email enviado com sucesso via SMTP (${senderEmail})!`
        });
      } catch (smtpErr: any) {
        console.error("[SMTP Send Error]:", smtpErr);
        return res.json({
          success: false,
          provider: "smtp",
          error: smtpErr.message || "Erro no envio via SMTP.",
          message: `Falha no envio via SMTP: ${smtpErr.message}`
        });
      }
    }

    // Fallback: Resend API
    const apiKey = (process.env.RESEND_API_KEY || "").replace(/^["']|["']$/g, "").trim();

    if (!apiKey) {
      console.log("[Email API] Nem SMTP nem RESEND_API_KEY configurados.");
      return res.json({
        success: false,
        provider: "simulated",
        error: "NO_EMAIL_PROVIDER_CONFIGURED",
        message: "Nenhum fornecedor de email configurado (configure o SMTP em Ferramentas ou defina RESEND_API_KEY).",
      });
    }

    // Sanitize SENDER_EMAIL to remove any surrounding quotes or malformed characters
    let rawSender = (req.body.from || req.body.senderEmail || process.env.SENDER_EMAIL || "onboarding@resend.dev").toString().trim();
    rawSender = rawSender.replace(/^["']|["']$/g, '').trim();

    let cleanEmail = rawSender;
    let namePrefix = "Data CoLAB";

    if (rawSender.includes("<") && rawSender.includes(">")) {
      const match = rawSender.match(/^(.*?)\s*<([^>]+)>/);
      if (match) {
        namePrefix = match[1].replace(/^["']|["']$/g, '').trim() || namePrefix;
        cleanEmail = match[2].trim();
      }
    }

    cleanEmail = cleanEmail.replace(/[<>'"\s]/g, '');
    if (!cleanEmail || !cleanEmail.includes('@')) {
      cleanEmail = 'onboarding@resend.dev';
    }

    const formattedFrom = `${namePrefix} <${cleanEmail}>`;

    const resend = new Resend(apiKey);
    const recipients = Array.isArray(to) ? to : [to];

    const emailPayload: any = {
      from: formattedFrom,
      to: recipients,
      subject,
      html: html || `<p>${text}</p>`,
    };

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailPayload.attachments = attachments.map((att: any) => ({
        filename: att.filename || 'anexo.csv',
        content: typeof att.content === 'string' ? Buffer.from(att.content, 'utf-8') : att.content,
      }));
    }

    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error("[Resend API Error]:", error);
      const errorMessage = typeof error === 'object' && 'message' in error ? (error as any).message : JSON.stringify(error);
      
      const isDomainTestingRestriction = errorMessage.includes("testing emails to your own email address") || errorMessage.includes("validation_error");

      return res.json({
        success: false,
        provider: "resend",
        error: errorMessage,
        isDomainTestingRestriction,
        message: isDomainTestingRestriction
          ? `[Resend Modo Teste]: O endereço ${recipients.join(', ')} não recebeu o email porque a conta de teste do Resend (onboarding@resend.dev) apenas permite enviar para o email do titular da conta Resend. Configure o servidor SMTP próprio em Ferramentas para enviar diretamente de @datacolab.pt.`
          : `Erro na Resend API: ${errorMessage}`
      });
    }

    console.log("[Resend API Success]: Email enviado com sucesso! ID:", data?.id);
    return res.json({ success: true, provider: "resend", id: data?.id, message: "Email enviado com sucesso via Resend API!" });
  } catch (err: any) {
    console.error("[Email API Server Exception]:", err);
    return res.json({ success: false, error: err?.message || "Erro interno no servidor ao processar envio de email." });
  }
});

// ==========================================
// Web Push & Attendance Notifications API
// ==========================================

// 1. Get VAPID Public Key for client browser subscription
app.get("/api/push/vapid-public-key", (req, res) => {
  return res.json({
    success: true,
    publicKey: vapidPublicKey,
  });
});

// 2. Dispatch Push Notification to a subscription
app.post("/api/push/send", async (req, res) => {
  try {
    const { subscription, payload } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: "Subscrição Push (endpoint) ausente ou inválida." });
    }

    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    
    const result = await webpush.sendNotification(subscription, payloadString, {
      TTL: 60 * 60 * 24, // 24h
      urgency: "high"
    });

    console.log("[WebPush API Success]: Mensagem entregue com status:", result.statusCode);
    return res.json({
      success: true,
      statusCode: result.statusCode,
      message: "Notificação push entregue com sucesso aos servidores de push do navegador."
    });
  } catch (err: any) {
    console.error("[WebPush API Error]:", err);
    const statusCode = err.statusCode || 500;
    const isExpired = statusCode === 410 || statusCode === 404;
    return res.status(statusCode).json({
      success: false,
      isExpired,
      error: err.message || "Erro ao despachar notificação Web Push.",
      statusCode
    });
  }
});

// 3. Test Push Notification endpoint
app.post("/api/push/test", async (req, res) => {
  try {
    const { subscription, title, body } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: "PushSubscription necessária para teste." });
    }

    const testPayload = JSON.stringify({
      title: title || "🔔 Teste de Notificação Push - Data CoLAB",
      body: body || "O Service Worker e o canal Web Push estão ativos e sincronizados!",
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      tag: `test-push-${Date.now()}`,
      vibrate: [200, 100, 200, 100, 300],
      requireInteraction: true,
      renotify: true,
      data: { url: "/?tab=clock", test: true },
      actions: [
        { action: "open", title: "Abrir Portal" },
        { action: "dismiss", title: "Fechar" }
      ]
    });

    const result = await webpush.sendNotification(subscription, testPayload, {
      TTL: 300,
      urgency: "high"
    });

    return res.json({
      success: true,
      statusCode: result.statusCode,
      message: "Notificação de teste enviada com sucesso para o dispositivo!"
    });
  } catch (err: any) {
    console.error("[WebPush Test API Error]:", err);
    const isExpired = err.statusCode === 410 || err.statusCode === 404;
    return res.status(err.statusCode || 500).json({
      success: false,
      isExpired,
      error: err.message || "Falha ao enviar notificação de teste.",
      statusCode: err.statusCode
    });
  }
});

// ==========================================
// Google Gemini AI API Service
// ==========================================

// Google Gemini AI API Service com Estratégia de Poupança Inteligente:
// 1. Prioridade Absoluta: Gasta primeiro a quota diária gratuita (Free Tier).
// 2. Transição Automática (Fallback): Apenas se a quota gratuita esgotar (Erro 429 / Quota Exceeded), recorre à Chave Paga.
function getGeminiClientForApiKey(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey.replace(/^["']|["']$/g, "").trim(),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function executeGeminiWithFreeFirstStrategy(prompt: string, systemInstruction?: string) {
  const freeKey = (process.env.GEMINI_FREE_API_KEY || process.env.GEMINI_API_KEY || "").replace(/^["']|["']$/g, "").trim();
  const paidKey = (process.env.GEMINI_PAID_API_KEY || "").replace(/^["']|["']$/g, "").trim();

  // 1. Tentar primeiro com a chave gratuita para consumir os tokens diários sem custos
  if (freeKey) {
    try {
      const client = getGeminiClientForApiKey(freeKey);
      const response = await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        ...(systemInstruction
          ? {
              config: {
                systemInstruction: typeof systemInstruction === "string" ? systemInstruction : undefined,
              },
            }
          : {}),
      });

      return {
        success: true,
        text: response.text || "",
        model: "gemini-3.8-flash",
        tierUsed: "free",
        message: "Processado com sucesso através da quota gratuita diária (Custo 0€).",
      };
    } catch (err: any) {
      const msg = (err?.message || "").toLowerCase();
      const isQuotaLimit = msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("429") || msg.includes("rate");

      // Se a quota gratuita estiver esgotada e existir uma chave paga configurada, faz comutação transparente
      if (isQuotaLimit && paidKey && paidKey !== freeKey) {
        console.warn("[Gemini API] Quota gratuita diária temporariamente esgotada (429 Quota Exceeded). A comutar automaticamente para a Chave Paga (Fallback)...");
        try {
          const paidClient = getGeminiClientForApiKey(paidKey);
          const responsePaid = await paidClient.models.generateContent({
            model: "gemini-3.8-flash",
            contents: prompt,
            ...(systemInstruction
              ? {
                  config: {
                    systemInstruction: typeof systemInstruction === "string" ? systemInstruction : undefined,
                  },
                }
              : {}),
          });

          return {
            success: true,
            text: responsePaid.text || "",
            model: "gemini-3.8-flash",
            tierUsed: "paid",
            message: "Quota gratuita esgotada. Processado com sucesso através da chave paga de contingência.",
          };
        } catch (paidErr: any) {
          console.error("[Gemini Paid Tier Error]:", paidErr);
          throw paidErr;
        }
      }

      // Se não for erro de quota ou não houver chave paga secundária, propaga o erro
      throw err;
    }
  }

  // Se apenas a chave paga estiver definida
  if (paidKey) {
    const paidClient = getGeminiClientForApiKey(paidKey);
    const responsePaid = await paidClient.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      ...(systemInstruction
        ? {
            config: {
              systemInstruction: typeof systemInstruction === "string" ? systemInstruction : undefined,
            },
          }
        : {}),
    });

    return {
      success: true,
      text: responsePaid.text || "",
      model: "gemini-3.8-flash",
      tierUsed: "paid",
      message: "Processado através da chave paga configurada.",
    };
  }

  throw new Error("Nenhuma chave Gemini (Gratuita ou Paga) configurada no servidor.");
}

// 1. Gemini status check com relatório de chaves (Gratuita vs Paga)
app.get("/api/gemini/status", async (req, res) => {
  try {
    const freeKey = (process.env.GEMINI_FREE_API_KEY || process.env.GEMINI_API_KEY || "").replace(/^["']|["']$/g, "").trim();
    const paidKey = (process.env.GEMINI_PAID_API_KEY || "").replace(/^["']|["']$/g, "").trim();

    if (!freeKey && !paidKey) {
      return res.json({ configured: false, status: "missing_key", message: "Nenhuma chave configurada." });
    }

    return res.json({
      configured: true,
      status: "ready",
      model: "gemini-3.8-flash",
      strategy: "free-first-then-paid",
      hasFreeTier: Boolean(freeKey),
      hasPaidTier: Boolean(paidKey && paidKey !== freeKey),
      message: paidKey && paidKey !== freeKey
        ? "Modo Inteligente Ativo: Utiliza a chave gratuita primeiro e comuta para a chave paga apenas se a quota esgotar."
        : "Modo Padrão Ativo com chave principal (prioriza quota gratuita disponível).",
    });
  } catch (err: any) {
    return res.json({ configured: false, error: err?.message || "Erro no cliente Gemini" });
  }
});

// 2. Gemini generate content endpoint com gestão inteligente de quotas
app.post("/api/gemini/generate", async (req, res) => {
  try {
    const { prompt, systemInstruction } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ success: false, error: "O campo 'prompt' é obrigatório." });
    }

    const result = await executeGeminiWithFreeFirstStrategy(prompt, systemInstruction);
    return res.json(result);
  } catch (err: any) {
    console.error("[Gemini API Error]:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Erro ao processar pedido no Gemini.",
    });
  }
});

// ==========================================
// Rotas de Exportação e Download de Documentos Oficiais
// ==========================================
const downloadsDirectory = path.join(process.cwd(), "public", "downloads");
app.use("/downloads", express.static(downloadsDirectory));

app.get("/api/export/carlos-domingues", (req, res) => {
  const format = ((req.query.format as string) || "pdf").toLowerCase();

  if (format === "csv") {
    const filePath = path.join(downloadsDirectory, "horario_carlos_domingues_setembro_2026.csv");
    res.setHeader("Content-Disposition", 'attachment; filename="horario_carlos_domingues_setembro_2026.csv"');
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.sendFile(filePath);
  }

  if (format === "excel" || format === "xls") {
    const filePath = path.join(downloadsDirectory, "horario_carlos_domingues_setembro_2026.xls");
    res.setHeader("Content-Disposition", 'attachment; filename="horario_carlos_domingues_setembro_2026.xls"');
    res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
    return res.sendFile(filePath);
  }

  // Por omissão: PDF
  const filePath = path.join(downloadsDirectory, "folha_assiduidade_carlos_domingues_setembro_2026.pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="folha_assiduidade_carlos_domingues_setembro_2026.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  return res.sendFile(filePath);
});

// Vite middleware for development / Static serving for production
async function startServer() {
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.on("error", (err: any) => {
    console.error(`[Servidor HTTP] Erro:`, err);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor a rodar na porta ${PORT}`);
  });
}

startServer();
