export function AsciiSplash({ compact = false }: { compact?: boolean }) {
  return (
    <pre
      className={
        compact
          ? "text-xs leading-none text-[rgb(var(--ascii))]"
          : "select-none text-[10px] leading-none text-[rgb(var(--ascii))] sm:text-xs"
      }
      aria-hidden="true"
    >
{`      ..:::::..
   .:+#########+:.
  :###=:....:=###:
 .##+          +##.
 :##   AITHY   ##:
 .##+   ////  +##.
  :###=::::=###:
   .:+#####:+.
      ':::'`}
    </pre>
  );
}
