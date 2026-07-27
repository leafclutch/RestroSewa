import "server-only";

// ─── Transactional email ───────────────────────────────────────────────────────
// Provider-agnostic on the outside; Resend on the inside, via a plain fetch so no
// SDK is added to the bundle (web-push is the only other external service and it's
// the same story). Swapping providers means rewriting only `deliver` below.
//
// It NEVER throws: the daily-summary cron loops over many restaurants and one bad
// address or a provider hiccup must not abort the rest. Failures come back as
// `{ ok: false }` for the caller to log.

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SUMMARY_FROM_EMAIL;

  if (!apiKey || !from) {
    return { ok: false, error: "Email is not configured (RESEND_API_KEY / SUMMARY_FROM_EMAIL missing)." };
  }
  const to = input.to.map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "No recipients." };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      // Resend returns a JSON error body; surface its message, never the key.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        if (body?.message) detail = body.message;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, error: detail };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Email send failed." };
  }
}
