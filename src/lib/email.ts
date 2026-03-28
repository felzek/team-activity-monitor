import { Resend } from "resend";
import type { Logger } from "pino";
import type { AppConfig } from "../config.js";

let resendClient: Resend | null = null;

function getClient(config: AppConfig): Resend | null {
  if (!config.resendApiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(config.resendApiKey);
  }
  return resendClient;
}

export async function sendInvitationEmail(
  config: AppConfig,
  logger: Logger,
  opts: {
    to: string;
    inviterName: string;
    organizationName: string;
    role: string;
    inviteUrl: string;
  }
): Promise<boolean> {
  const client = getClient(config);
  if (!client) {
    logger.warn({ to: opts.to }, "RESEND_API_KEY not configured — invitation email skipped");
    return false;
  }

  const { to, inviterName, organizationName, role, inviteUrl } = opts;

  try {
    const { error } = await client.emails.send({
      from: config.emailFrom,
      to,
      subject: `${inviterName} invited you to ${organizationName}`,
      html: buildInvitationHtml({ inviterName, organizationName, role, inviteUrl, appName: config.appName }),
      text: buildInvitationText({ inviterName, organizationName, role, inviteUrl, appName: config.appName }),
    });

    if (error) {
      logger.error({ err: error, to }, "Failed to send invitation email");
      return false;
    }

    logger.info({ to, organizationName }, "Invitation email sent");
    return true;
  } catch (err) {
    logger.error({ err, to }, "Failed to send invitation email");
    return false;
  }
}

interface EmailContent {
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
  appName: string;
}

function buildInvitationHtml(c: EmailContent): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're invited</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e5ea;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;">
              <p style="margin:0;font-size:14px;font-weight:600;color:#5b5ef4;">${escapeHtml(c.appName)}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#1d1d1f;">You've been invited</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3a3a3c;">
                <strong>${escapeHtml(c.inviterName)}</strong> has invited you to join
                <strong>${escapeHtml(c.organizationName)}</strong> as a <strong>${escapeHtml(c.role)}</strong>.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background:#5b5ef4;">
                    <a href="${escapeHtml(c.inviteUrl)}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;color:#86868b;line-height:1.5;">
                This invitation expires in 7 days. If the button doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin:8px 0 0;font-size:13px;color:#5b5ef4;word-break:break-all;">
                <a href="${escapeHtml(c.inviteUrl)}" style="color:#5b5ef4;">${escapeHtml(c.inviteUrl)}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e5ea;">
              <p style="margin:0;font-size:12px;color:#86868b;">
                You received this because ${escapeHtml(c.inviterName)} invited ${escapeHtml(c.organizationName)} to use ${escapeHtml(c.appName)}.
                If you didn't expect this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildInvitationText(c: EmailContent): string {
  return `${c.inviterName} invited you to join ${c.organizationName} as a ${c.role}.

Accept the invitation:
${c.inviteUrl}

This invitation expires in 7 days.

--
${c.appName}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
