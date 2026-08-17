const DEFAULT_RESEND_FROM_EMAIL = "alerts@send.seo-true.com";
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function resendFromAddress(
  displayName = "SEO Dashboard",
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.RESEND_FROM_EMAIL?.replace(/[\r\n]/g, "").trim();
  const email = configured && EMAIL_PATTERN.test(configured)
    ? configured
    : DEFAULT_RESEND_FROM_EMAIL;
  const safeName = displayName.replace(/[\r\n"<>]/g, "").trim() || "SEO Dashboard";
  return `${safeName} <${email}>`;
}
