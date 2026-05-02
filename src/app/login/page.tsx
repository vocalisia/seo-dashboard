import { LoginForm } from "./login-form";

export default function LoginPage() {
  // Server-side check: show credentials form whenever LOCAL_DEV_PASSWORD is configured
  const showDevLogin =
    !!process.env.LOCAL_DEV_PASSWORD?.trim() ||
    process.env.NEXT_PUBLIC_SHOW_DEV_LOGIN === "true";

  return <LoginForm showDevLogin={showDevLogin} />;
}
