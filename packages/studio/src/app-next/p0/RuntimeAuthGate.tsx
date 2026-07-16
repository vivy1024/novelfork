import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, buttonVariants } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  RUNTIME_AUTH_API_PATHS,
  RuntimeHttpError,
  clearRuntimeAuthentication,
  getRuntimeToken,
  isPasskeySupported,
  isUserCancelledWebAuthn,
  runtimeJson,
  runtimePasskeyLogin,
  runtimePasskeyMfaVerify,
  runtimeSsoExchange,
  runtimeSsoStartUrl,
  setRuntimeToken,
  subscribeRuntimeAuthInvalidation,
  type RuntimeAuthStatus,
  type RuntimeSessionResponse,
  type RuntimeSsoProvider,
} from "../runtime/auth";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error";
type PublicAuthSnapshot = RuntimeAuthStatus & { readonly ssoProviders: readonly RuntimeSsoProvider[] };
type PublicAuthState = PublicAuthSnapshot | null;

function sessionToken(response: RuntimeSessionResponse): string {
  if (!response.token?.trim()) throw new Error("Runtime authentication response is missing token");
  return response.token;
}

function authErrorMessage(caught: unknown): string {
  if (!(caught instanceof RuntimeHttpError)) return caught instanceof Error ? caught.message : String(caught);
  switch (caught.code) {
    case "INVALID_CREDENTIALS": return "用户名或密码不正确。";
    case "ACCOUNT_DISABLED": return "此账户已被禁用，请联系管理员。";
    case "REGISTRATION_CLOSED": return "当前实例已关闭注册，请联系管理员。";
    case "USERNAME_TAKEN": return "用户名已被占用。";
    case "MFA_CODE_INVALID": return "验证码不正确，请重试。";
    case "MFA_TOKEN_INVALID": return "二次验证会话已过期，请重新登录。";
    case "MFA_LOCKED": return "二次验证失败次数过多，请稍后重试。";
    case "PASSKEY_AUTH_FAILED": return "Passkey 验证失败，请重试或改用密码登录。";
    case "SSO_CODE_INVALID": return "SSO 登录链接已过期或已使用，请重新开始登录。";
    case "SSO_DOMAIN_DENIED": return "该 SSO 账户的邮箱域名不在允许范围内。";
    case "SSO_SIGNUP_DISABLED": return "该 SSO 提供方未允许自动创建账户。";
    default: return caught.message;
  }
}

function ssoErrorMessage(value: string): string {
  const messages: Record<string, string> = {
    unknown_provider: "SSO 提供方不存在或已被禁用。",
    start_failed: "无法开始 SSO 登录，请稍后重试。",
    missing_params: "SSO 回调缺少必要参数。",
    state_expired: "SSO 登录状态已过期，请重新开始登录。",
    verification_failed: "SSO 身份验证失败，请重试。",
    login_failed: "SSO 登录失败，请检查身份提供方配置。",
    already_linked_other: "该 SSO 身份已关联到其他账户。",
  };
  return messages[value] ?? `SSO 登录失败：${value.replaceAll("_", " ")}`;
}

function registrationError(username: string, password: string): string | null {
  const normalizedUsername = username.trim();
  if (normalizedUsername.length < 3) return "用户名至少需要 3 个字符。";
  if (normalizedUsername.length > 50) return "用户名不能超过 50 个字符。";
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUsername)) return "用户名只能包含字母、数字、连字符和下划线。";
  if (password.length < 8) return "密码至少需要 8 个字符。";
  if (password.length > 128) return "密码不能超过 128 个字符。";
  return null;
}

function RuntimeLoginPage({ authStatus, onAuthenticated }: { readonly authStatus: PublicAuthSnapshot; readonly onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">(authStatus.hasUsers ? "login" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<{ token: string; methods: readonly ("totp" | "backup_code" | "passkey")[] } | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"totp" | "backup_code" | "passkey">("totp");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoPanel, setInfoPanel] = useState<"protocol" | "privacy" | "security" | null>(null);

  const finish = (response: RuntimeSessionResponse) => {
    setRuntimeToken(sessionToken(response));
    onAuthenticated();
  };

  useEffect(() => {
    if (getRuntimeToken() || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get("sso_error");
    const ssoCode = params.get("sso_code");
    if (!ssoError && !ssoCode) return;

    // Consume callback query parameters before the router mounts so a one-time
    // SSO code cannot be lost to the Studio catch-all redirect or leaked in
    // browser history.
    window.history.replaceState({}, "", window.location.pathname);
    if (ssoError) {
      setError(ssoErrorMessage(ssoError));
      return;
    }
    if (!ssoCode) return;

    let cancelled = false;
    setSubmitting(true);
    void runtimeSsoExchange(ssoCode)
      .then((response) => {
        if (!cancelled) finish(response);
      })
      .catch((caught) => {
        if (!cancelled) setError(authErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setSubmitting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitPasskey = async () => {
    setSubmitting(true);
    setError(null);
    try {
      finish(await runtimePasskeyLogin());
    } catch (caught) {
      if (!isUserCancelledWebAuthn(caught)) setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "register") {
        if (!authStatus.registrationOpen && authStatus.hasUsers) {
          throw new Error("当前实例已关闭注册，请联系管理员。");
        }
        const validationError = registrationError(username, password);
        if (validationError) {
          setError(validationError);
          return;
        }
        finish(await runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.register, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password, language: "zh" }),
        }, { invalidateOn401: false }));
        return;
      }
      const response = await runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.login, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      }, { invalidateOn401: false });
      if (response.mfaRequired) {
        if (!response.mfaToken) throw new Error("Runtime MFA challenge is missing mfaToken");
        const methods: readonly ("totp" | "backup_code" | "passkey")[] = response.methods?.length ? response.methods : ["totp"];
        setMfa({ token: response.mfaToken, methods });
        setMfaMethod(methods[0] ?? "totp");
        return;
      }
      finish(response);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mfa) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mfaMethod === "passkey") {
        finish(await runtimePasskeyMfaVerify(mfa.token));
      } else {
        finish(await runtimeJson<RuntimeSessionResponse>(RUNTIME_AUTH_API_PATHS.verifyMfa, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mfaToken: mfa.token, method: mfaMethod, code: mfaCode }),
        }, { invalidateOn401: false }));
      }
    } catch (caught) {
      if (isUserCancelledWebAuthn(caught)) return;
      if (caught instanceof RuntimeHttpError && (caught.code === "MFA_TOKEN_INVALID" || caught.code === "MFA_LOCKED")) {
        setMfa(null);
        setMfaCode("");
        setPassword("");
      }
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4" data-testid="runtime-login-page">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">NovelFork</p>
        <h1 className="mt-1 text-2xl font-semibold">{mfa ? "二次验证" : mode === "login" ? "登录" : "创建账户"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">使用 NarraFork Runtime 账户继续小说创作。</p>
        {!authStatus.hasUsers && (
          <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm" role="status">
            首次使用请创建账户；第一个账户将自动成为管理员。
          </div>
        )}
        {mfa ? (
          <form className="mt-6 space-y-4" onSubmit={submitMfa}>
            {mfa.methods.length > 1 && (
              <label className="block space-y-1">
                <span className="text-sm font-medium">验证方式</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={mfaMethod} onChange={(event) => setMfaMethod(event.currentTarget.value as "totp" | "backup_code" | "passkey")}>
                  {mfa.methods.map((method) => <option key={method} value={method}>{method === "backup_code" ? "备用码" : method === "passkey" ? "Passkey" : "验证器代码"}</option>)}
                </select>
              </label>
            )}
            {mfaMethod === "passkey" ? (
              <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">提交后将打开浏览器 Passkey 验证提示。</p>
            ) : (
              <label className="block space-y-1">
                <span className="text-sm font-medium">{mfaMethod === "backup_code" ? "备用码" : "验证码"}</span>
                <Input autoFocus autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.currentTarget.value)} required />
              </label>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setMfa(null); setMfaCode(""); }} disabled={submitting}>返回</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "验证中…" : "验证并登录"}</Button>
            </div>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submitCredentials}>
            <label className="block space-y-1">
              <span className="text-sm font-medium">用户名</span>
              <Input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.currentTarget.value)} required />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">密码</span>
              <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "处理中…" : mode === "login" ? "登录" : "创建并登录"}</Button>
            {mode === "login" && isPasskeySupported() ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => void submitPasskey()} disabled={submitting}>
                {submitting ? "验证中…" : "使用 Passkey 登录"}
              </Button>
            ) : null}
            {mode === "login" && authStatus.ssoProviders.length > 0 ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>或使用企业身份登录</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="grid gap-2">
                  {authStatus.ssoProviders.map((provider) => (
                    <a
                      key={provider.id}
                      className={buttonVariants({ variant: "outline", className: "w-full" })}
                      data-testid={`runtime-sso-provider-${provider.id}`}
                      href={runtimeSsoStartUrl(provider.id)}
                    >
                      使用 {provider.name} 登录
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {(authStatus.registrationOpen || !authStatus.hasUsers) && (
              <Button type="button" variant="link" className="w-full" onClick={() => setMode((current) => current === "login" ? "register" : "login")} disabled={submitting}>
                {mode === "login" ? "没有账户？创建账户" : "已有账户？返回登录"}
              </Button>
            )}
            <div className="flex justify-center gap-3 pt-2 text-xs text-muted-foreground">
              {([[
                "protocol", "协议与许可",
              ], ["privacy", "隐私说明"], ["security", "安全说明"]] as const).map(([key, label]) => (
                <button key={key} type="button" className="underline-offset-2 hover:underline" onClick={() => setInfoPanel(infoPanel === key ? null : key)}>{label}</button>
              ))}
            </div>
            {infoPanel ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground" role="note">
                {infoPanel === "protocol" && "NovelFork Studio 仅作为 Runtime 的产品界面；账户、会话和小说数据由 NarraFork Runtime 按当前实例策略处理。"}
                {infoPanel === "privacy" && "登录凭据只提交给当前 Runtime；Studio 不记录密码、Passkey 响应或 Client Secret。登出和认证失效时会清除命名空间内的 Runtime 缓存。"}
                {infoPanel === "security" && "Runtime 负责 JWT、disabled_at、管理员门禁、MFA 与 WebAuthn 校验；请在 HTTPS 或受信任的本机环境中使用 Passkey。"}
              </div>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}

export function RuntimeAuthGate({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [publicAuth, setPublicAuth] = useState<PublicAuthState>(null);
  const [error, setError] = useState<string | null>(null);
  const check = useCallback(async () => {
    setStatus("checking");
    setError(null);
    try {
      const authStatus = await runtimeJson<RuntimeAuthStatus>(RUNTIME_AUTH_API_PATHS.status, {}, { invalidateOn401: false });
      const publicSnapshot: PublicAuthSnapshot = { ...authStatus, ssoProviders: [] };
      setPublicAuth(publicSnapshot);
      if (!getRuntimeToken()) {
        try {
          const providerPayload = await runtimeJson<{ providers?: readonly RuntimeSsoProvider[] }>(RUNTIME_AUTH_API_PATHS.ssoProviders, {}, { invalidateOn401: false });
          setPublicAuth({ ...publicSnapshot, ssoProviders: Array.isArray(providerPayload.providers) ? providerPayload.providers : [] });
        } catch {
          // SSO is optional. A provider/configuration failure must not block
          // password registration or login for the local Runtime account.
        }
        setStatus("unauthenticated");
        return;
      }
      await runtimeJson(RUNTIME_AUTH_API_PATHS.currentUser);
      setStatus("authenticated");
    } catch (caught) {
      if (caught instanceof RuntimeHttpError && caught.status !== 401) {
        setError(caught.message);
        setStatus("error");
        return;
      }
      clearRuntimeAuthentication("unauthorized");
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    void check();
    return subscribeRuntimeAuthInvalidation(() => {
      // Logout and expired-token events must refresh the public status as well;
      // otherwise the first-run "create account" state would remain cached
      // after the first user has been created.
      void check();
    });
  }, [check]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = status === "unauthenticated" ? "/login" : status === "authenticated" && window.location.pathname === "/login" ? "/next" : null;
    if (target && window.location.pathname !== target) window.history.replaceState(null, "", target);
  }, [status]);

  if (status === "checking") {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在验证 Runtime 登录状态…</main>;
  }
  if (status === "error") {
    return <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6"><p role="alert" className="text-sm text-destructive">无法验证 Runtime 登录状态：{error}</p><Button onClick={() => void check()}>重试</Button></main>;
  }
  if (status === "unauthenticated") {
    if (!publicAuth) {
      return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-destructive">无法读取 Runtime 注册状态。</main>;
    }
    return <RuntimeLoginPage authStatus={publicAuth} onAuthenticated={() => { setStatus("authenticated"); }} />;
  }
  return <>{children}</>;
}
