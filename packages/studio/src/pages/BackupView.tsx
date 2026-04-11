/**
 * BackupView — encrypted backup management page (Tauri only).
 */
import { useState } from "react";
import { Shield, Loader2, Download, Lock, Clock } from "lucide-react";
import { useBackup } from "../hooks/use-backup";
import type { BackupPayload } from "../hooks/use-backup";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";

interface Nav { toDashboard: () => void }

export function BackupView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { createBackup, restoreBackup, backups, loading } = useBackup();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restorePass, setRestorePass] = useState("");
  const [preview, setPreview] = useState<BackupPayload | null>(null);

  const handleCreate = async () => {
    setError(null);
    if (!passphrase || passphrase !== confirm) {
      setError(passphrase ? "Passphrases do not match" : "Passphrase required");
      return;
    }
    setCreating(true);
    try {
      await createBackup(passphrase);
      setPassphrase("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setError(null);
    if (!restorePass) { setError("Passphrase required"); return; }
    try {
      const data = await restoreBackup(filename, restorePass);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decryption failed");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("backup.title")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Shield size={28} className="text-primary" />
          {t("backup.title")}
        </h1>
      </div>

      {error && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${c.error}`}>{error}</div>
      )}

      {/* Create Backup */}
      <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Lock size={18} className="text-primary" />
          {t("backup.create")}
        </h2>
        <div className="grid gap-3 max-w-sm">
          <input
            type="password"
            placeholder={t("backup.passphrase")}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${c.input}`}
          />
          <input
            type="password"
            placeholder={t("backup.confirm")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${c.input}`}
          />
          <button
            onClick={handleCreate}
            disabled={creating || loading}
            className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-50`}
          >
            {creating ? <Loader2 size={16} className="animate-spin inline mr-2" /> : null}
            {t("backup.create")}
          </button>
        </div>
      </div>

      {/* Backup List */}
      <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-4`}>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock size={18} className="text-primary" />
          {t("backup.restore")}
        </h2>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        )}
        {!loading && backups.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">{t("backup.noBackups")}</p>
        )}
        {!loading && backups.length > 0 && (
          <div className="space-y-2">
            {backups.map((b) => (
              <div key={b.filename} className="flex items-center gap-3 py-3 border-b border-border/30 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{new Date(b.timestamp).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{(b.size / 1024).toFixed(1)} KB</p>
                </div>
                {restoring === b.filename ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder={t("backup.passphrase")}
                      value={restorePass}
                      onChange={(e) => setRestorePass(e.target.value)}
                      className={`px-2 py-1 rounded text-xs w-40 ${c.input}`}
                    />
                    <button
                      onClick={() => handleRestore(b.filename)}
                      className={`px-3 py-1 text-xs rounded ${c.btnPrimary}`}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => { setRestoring(null); setRestorePass(""); }}
                      className={`px-3 py-1 text-xs rounded ${c.btnSecondary}`}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setRestoring(b.filename); setRestorePass(""); setPreview(null); }}
                    className={`px-3 py-1.5 text-xs rounded-lg ${c.btnSecondary}`}
                  >
                    {t("backup.restore")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className={`border ${c.cardStatic} rounded-lg p-5 space-y-3`}>
          <h2 className="text-lg font-semibold">Preview</h2>
          <p className="text-sm text-muted-foreground">Created: {preview.createdAt}</p>
          <div className="space-y-2">
            {preview.books.map((book) => (
              <div key={book.id} className="text-sm">
                <span className="font-medium">{(book.config.title as string) ?? book.id}</span>
                <span className="text-muted-foreground ml-2">
                  {book.chapters.length} chapters, {book.truthFiles.length} truth files
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
