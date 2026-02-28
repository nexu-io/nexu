import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const sender = process.env.EMAIL_SENDER || "Nexu <noreply@nexu.io>";

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set, skipping email send");
    console.warn(`[email] To: ${params.to} | Subject: ${params.subject}`);
    console.warn(`[email] Body: ${params.html}`);
    return;
  }
  await resend.emails.send({
    from: sender,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
