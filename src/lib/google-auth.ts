import { google } from "googleapis";

export function getGoogleAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
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
