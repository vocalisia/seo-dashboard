import { LoginForm } from "./login-form";

export default function LoginPage() {
  const showDevLogin = process.env.NEXT_PUBLIC_SHOW_DEV_LOGIN === "true";

  return <LoginForm showDevLogin={showDevLogin} />;
}
