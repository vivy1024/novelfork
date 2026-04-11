/**
 * TauriLogin — shown in Tauri mode when no auth credentials are stored.
 * User either pastes a launch token from Sub2API or waits for deep link.
 */

import { useState } from "react";
import { KeyRound, ExternalLink } from "lucide-react";
import type { TFunction } from "../hooks/use-i18n";

interface TauriLoginProps {
  onLogin: (token: string) => void;
  onSkip: () => void;
  relayUrl: string;
  t: TFunction;
}

export function TauriLogin({ onLogin, onSkip, relayUrl, t }: TauriLoginProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      onLogin(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSub2api = () => {
    // Open Sub2API in default browser
    const url = relayUrl.replace(/\/+$/, "");
    window.open(url, "_blank");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full mx-4 space-y-8 text-center">
        <div className="space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <KeyRound size={32} className="text-primary" />
          </div>
          <h1 className="text-3xl font-serif font-medium text-foreground">
            InkOS Studio
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("login.description")}
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleOpenSub2api}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 text-sm font-bold bg-primary text-primary-foreground rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
          >
            <ExternalLink size={18} />
            {t("login.openSub2api")}
          </button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <span>{t("login.orPasteToken")}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("login.tokenPlaceholder")}
            rows={3}
            className="w-full px-4 py-3 text-sm bg-secondary/50 border border-border rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
          />

          <button
            onClick={handleSubmit}
            disabled={!token.trim() || loading}
            className="w-full px-6 py-3 text-sm font-bold bg-secondary text-foreground rounded-xl hover:bg-secondary/80 transition-all disabled:opacity-40"
          >
            {loading ? t("login.verifying") : t("login.submit")}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("login.hint")}
        </p>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
        >
          {t("login.skip")}
        </button>
      </div>
    </div>
  );
}
