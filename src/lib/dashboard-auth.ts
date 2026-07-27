type AuthEnvironment = Partial<Pick<NodeJS.ProcessEnv, "DASHBOARD_AUTH_USER" | "DASHBOARD_AUTH_PASSWORD" | "BASIC_AUTH_USER" | "BASIC_AUTH_PASS" | "LOCAL_DEV_PASSWORD" | "NODE_ENV">>;

export type DashboardCredentials = { user: string; password: string };

function cleanEnvValue(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]/g, "").trim();
}

export function getDashboardCredentials(env: AuthEnvironment = process.env as AuthEnvironment): DashboardCredentials | null {
  const user = cleanEnvValue(env.DASHBOARD_AUTH_USER) || cleanEnvValue(env.BASIC_AUTH_USER);
  const password = cleanEnvValue(env.DASHBOARD_AUTH_PASSWORD) || cleanEnvValue(env.BASIC_AUTH_PASS) || (env.NODE_ENV !== "production" ? cleanEnvValue(env.LOCAL_DEV_PASSWORD) : "");
  return user && password ? { user, password } : null;
}

export function dashboardCredentialsMatch(expected: DashboardCredentials, user: unknown, password: unknown): boolean {
  const providedUser = typeof user === "string" ? user : "";
  const providedPassword = typeof password === "string" ? password : "";
  if (expected.user.length !== providedUser.length || expected.password.length !== providedPassword.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.user.length; index += 1) difference |= expected.user.charCodeAt(index) ^ providedUser.charCodeAt(index);
  for (let index = 0; index < expected.password.length; index += 1) difference |= expected.password.charCodeAt(index) ^ providedPassword.charCodeAt(index);
  return difference === 0;
}
