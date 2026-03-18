export function LanguageSelector({ onSelect }: { onSelect: (lang: "zh" | "en") => void }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-12">
        {/* Logo */}
        <div>
          <div className="flex items-baseline justify-center gap-1 mb-3">
            <span className="font-serif text-5xl italic text-primary">Ink</span>
            <span className="text-4xl font-semibold tracking-tight">OS</span>
          </div>
          <div className="text-sm text-muted-foreground/50">Studio</div>
        </div>

        {/* Language cards */}
        <div className="flex gap-6">
          <button
            onClick={() => onSelect("zh")}
            className="group w-72 border border-border rounded-lg p-10 hover:border-primary/50 transition-all duration-300 text-left"
          >
            <div className="font-serif text-2xl mb-2">中文创作</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              玄幻 · 仙侠 · 都市 · 恐怖
            </div>
            <div className="text-xs text-muted-foreground/40 mt-4">
              番茄小说 · 起点中文网
            </div>
          </button>

          <button
            onClick={() => onSelect("en")}
            className="group w-72 border border-border rounded-lg p-10 hover:border-primary/50 transition-all duration-300 text-left"
          >
            <div className="font-serif text-2xl mb-2 italic">English Writing</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              LitRPG · Progression · Romantasy · Sci-Fi
            </div>
            <div className="text-xs text-muted-foreground/40 mt-4">
              Royal Road · Kindle Unlimited
            </div>
          </button>
        </div>

        <div className="text-[11px] text-muted-foreground/30">
          This can be changed later in Settings
        </div>
      </div>
    </div>
  );
}
