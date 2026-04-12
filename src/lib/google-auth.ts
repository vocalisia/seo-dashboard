import { google } from "googleapis";

function getServiceAccountCredentials() {
  if (process.env.GOOGLE_CREDENTIALS) {
    // Handle escaped newlines in private_key that break JSON.parse
    const raw = process.env.GOOGLE_CREDENTIALS
      .replace(/\n/g, "\\n")  // real newlines → escaped
      .replace(/\\\\n/g, "\\n"); // double-escaped → single escaped
    try {
      return JSON.parse(raw);
    } catch {
      // Last resort: try cleaning control characters
      const cleaned = process.env.GOOGLE_CREDENTIALS.replace(/[\x00-\x1F\x7F]/g, (c) =>
        c === "\n" || c === "\r" || c === "\t" ? c : ""
      );
      return JSON.parse(cleaned);
    }
  }
  return {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

export function getGoogleAuth(accessToken?: string) {
  if (accessToken) {
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });
    return oauth2;
  }
  const creds = getServiceAccountCredentials();
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
      "https://www.googleapis.com/auth/indexing",
    ],
  });
}

export function getAnalyticsClient(accessToken?: string) {
  return google.analyticsdata({ version: "v1beta", auth: getGoogleAuth(accessToken) as never });
}

export function getSearchConsoleClient(accessToken?: string) {
  return google.searchconsole({ version: "v1", auth: getGoogleAuth(accessToken) as never });
}
