import type { ReactNode } from 'react';

/** Only the content scrolls; never wrap several modules in a shared scroll area. */
export function ModuleCard({ label, eyebrow, actions, pinned, children, className = 'h-[640px]' }: {
  label: string; eyebrow?: string; actions?: ReactNode; pinned?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section aria-label={label} className={`workbench-card flex min-h-0 flex-col overflow-hidden p-4 ${className}`}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
      <div>{eyebrow && <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{eyebrow}</p>}
        <h2 className="mt-1 text-base font-bold">{label}</h2></div>
      {actions}
    </header>
    {pinned}
    <div className="module-scroll mt-3" tabIndex={0} role="region" aria-label={`${label}内容`}>{children}</div>
  </section>;
}
