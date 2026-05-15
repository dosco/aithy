import type { ReactNode } from "react";

export function PageFrame({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="app-page-frame mx-auto flex min-h-screen w-full flex-col pt-24">
      <div className="mb-10">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-3xl break-words text-4xl font-normal leading-tight text-balance sm:text-6xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
