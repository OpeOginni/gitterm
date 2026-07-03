import env from "@gitterm/env/server";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { RenderedEmail } from "./invite-templates";

export interface OutgoingEmail extends RenderedEmail {
  to: string;
}

type EmailProvider = "smtp" | "resend" | "none";

/**
 * Resolves the active email provider from configuration.
 *
 * Honors an explicit EMAIL_PROVIDER; in "auto" mode it picks SMTP when
 * SMTP_HOST is set, else Resend when RESEND_API_KEY is set, else "none".
 */
function resolveProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return "smtp";
    case "resend":
      return "resend";
    case "auto":
    default: {
      if (env.SMTP_HOST) return "smtp";
      if (env.RESEND_API_KEY) return "resend";
      return "none";
    }
  }
}

type SmtpTransporter = ReturnType<typeof nodemailer.createTransport>;

let transporter: SmtpTransporter | null = null;

function getSmtpTransporter(): SmtpTransporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // SMTP_SECURE unset → infer from port (465 = implicit TLS, 587 = STARTTLS upgrade).
      secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

/**
 * Single integration point for transactional email.
 *
 * Sends via SMTP (nodemailer) or Resend based on configuration; when no
 * provider is configured it logs the rendered message so dev/self-hosted
 * environments keep working without a mail provider.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const provider = resolveProvider();

  if (provider === "none") {
    console.info(`[email] (no provider configured) → ${message.to}: ${message.subject}`);
    return;
  }

  if (provider === "smtp") {
    let info;
    try {
      info = await getSmtpTransporter().sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        replyTo: env.EMAIL_REPLY_TO ?? undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (error) {
      // Log full details server-side only; surface a generic message so raw
      // SMTP responses (host, auth user, server greeting) never reach clients.
      console.error(`[email] SMTP delivery failed → ${message.to}:`, error);
      throw new Error("Email delivery failed", { cause: error });
    }

    if (info.rejected.length > 0) {
      console.error(`[email] SMTP delivery rejected → ${message.to}:`, info.rejected);
      throw new Error(`Email delivery rejected for ${message.to}`);
    }
    return;
  }

  const { error } = await getResend().emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (error) {
    console.error(`[email] Resend delivery failed → ${message.to}:`, error);
    throw new Error(`Email delivery failed: ${error.message}`);
  }
}
