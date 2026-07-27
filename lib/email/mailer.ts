import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

// ─── Transactional email — Gmail SMTP ──────────────────────────────────────────
// All outgoing report mail leaves from ONE HRestroSewa Gmail account over SMTP with
// an app password. Restaurants never configure SMTP; they only choose recipients.
// Credentials live ONLY in server env vars (GMAIL_USER / GMAIL_APP_PASSWORD) and
// never reach the client — this module is `server-only`.
//
// It NEVER throws: the caller (report orchestrator) logs the outcome per restaurant,
// and one bad send must not abort a batch. Retries a few times with linear backoff
// before giving up, and reports how many attempts it took.

export type EmailAttachment = {
  filename: string;
  content: Uint8Array | Buffer;
  contentType?: string;
};

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
};

export type SendResult =
  | { ok: true; id?: string; attempts: number }
  | { ok: false; error: string; attempts: number };

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cached across warm invocations of a serverless function.
let cached: Transporter | null = null;

function getTransport(): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // implicit TLS
      auth: { user, pass },
    });
  }
  return cached;
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const transport = getTransport();
  const user = process.env.GMAIL_USER;
  if (!transport || !user) {
    return {
      ok: false,
      error: "Email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing).",
      attempts: 0,
    };
  }

  const to = input.to.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "No recipients.", attempts: 0 };

  const fromName = process.env.SUMMARY_FROM_NAME || "HRestroSewa Reports";
  const message = {
    from: `"${fromName}" <${user}>`,
    to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: (input.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
      contentType: a.contentType ?? "application/pdf",
    })),
  };

  let lastError = "send failed";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await transport.sendMail(message);
      return { ok: true, id: info.messageId, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "send failed";
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1500); // 1.5s, 3s
    }
  }
  return { ok: false, error: lastError, attempts: MAX_ATTEMPTS };
}
