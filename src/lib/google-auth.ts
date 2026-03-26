import { google } from "googleapis";

function getCredentials() {
  // Try GOOGLE_CREDENTIALS first (full JSON), then individual vars
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  return {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

export function getGoogleAuth() {
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
  });
  return auth;
}

export function getAnalyticsClient() {
  return google.analyticsdata({ version: "v1beta", auth: getGoogleAuth() });
}

export function getSearchConsoleClient() {
  return google.searchconsole({ version: "v1", auth: getGoogleAuth() });
}
