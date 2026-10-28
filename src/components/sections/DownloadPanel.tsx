"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { SystemIcon } from "@/components/ui/icons";
import { formatSize } from "@/lib/format";
import { detectPlatform } from "@/lib/platform";
import type { DevBuild, Download, LauncherRelease, Platform, PlatformId } from "@/lib/releases";

/** "25 October 2026", the same on the server and in the browser (UTC, one locale), so it never changes on hydration. */
const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "5 minutes ago", "3 hours ago", "yesterday", "2 months ago": filled in the browser only, after the page is shown. */
function ago(iso: string): string {
  const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (minutes < 1440) return rtf.format(-Math.floor(minutes / 60), "hour");
  if (days < 30) return rtf.format(-days, "day");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

const noChange = () => () => {};
function browserPlatform(): PlatformId | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPlatform(nav.userAgent, nav.userAgentData?.platform);
}

/** "AppImage · x86-64 · 137.45 MB"; without the size when it is not known (read from an updater manifest). */
const withSize = (d: Download) => (d.size > 0 ? `${d.label} · ${formatSize(d.size)}` : d.label);

/** A tick before a line of what a system needs. */
const Check = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[3px] size-3.5 flex-none fill-none stroke-brand stroke-2">
    <path d="m3 8.5 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One system: its version, what it runs on, and one button; the other formats folded under it. */
function SystemCard({ p, i, mine, release, dev, devAgo, fallback }: {
  p: Platform;
  i: number;
  mine: boolean;
  release: LauncherRelease | null;
  dev: { version: string; url: string } | null;
  devAgo: string;
  fallback: string;
}) {
  return (
    // Four rows shared with the cards beside it (subgrid), so their buttons line up whatever the text above.
    <article
      style={{ "--i": i } as CSSProperties}
      className={`dl-card surface surface-link relative row-span-4 grid grid-cols-[minmax(0,1fr)] grid-rows-subgrid gap-0 p-5 sm:p-6 ${mine ? "dl-mine border-brand/70 max-sm:order-first" : ""}`}
    >
      <div className="flex items-center gap-3.5">
        <span
          className={`dl-tile grid size-12 flex-none place-items-center rounded-xl border ${mine ? "border-amber/50 bg-amber/10 text-amber" : "border-line bg-white/[.03] text-hi"}`}
        >
          <SystemIcon id={p.id} />
        </span>
        <h3 className="font-orbitron text-[19px] font-bold text-text">{p.name}</h3>
      </div>
      {mine && (
        <span className="absolute -top-3 right-5 rounded-full border border-amber/50 bg-[#2a1800] px-2.5 py-1 font-orbitron text-[10px] font-bold uppercase leading-none tracking-[.14em] text-amber">
          Your system
        </span>
      )}

      <div className="pt-5">
        {release && (
          <p className="font-orbitron text-[12px] font-bold tracking-[.08em] text-gold">
            v{release.version}
            {release.date && (
              <span className="font-sans font-normal tracking-normal text-dim">
                {" "}
                · <time dateTime={release.date}>{longDate(release.date)}</time>
              </span>
            )}
          </p>
        )}
        <ul className={`grid gap-1.5 text-[14px] leading-snug text-soft ${release ? "mt-2.5" : ""}`}>
          {p.supports.map((line) => (
            <li key={line} className="flex gap-2">
              <Check />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="self-end pt-5">
        {p.main ? (
          <a href={p.main.url} className={`btn w-full ${mine ? "btn-primary" : ""}`} download>
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none fill-none stroke-current stroke-2">
              <path d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M3 13.5h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Download
            <span className="sr-only"> for {p.name}</span>
          </a>
        ) : (
          <a href={release?.url || fallback} className="btn w-full">
            Open the release page
          </a>
        )}
        <p className="mt-2 text-center text-[12px] text-dim">
          {p.main ? withSize(p.main) : release ? "Not part of this release" : "Files are listed on GitHub"}
        </p>
        {/* The newest build of master, for those who want what was merged today. Through the site's own
            redirect (app/download/dev), which finds the current file when it is followed. */}
        {dev && (
          <a
            href={dev.url}
            className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-soft no-underline transition-colors hover:border-amber/60 hover:text-amber"
          >
            <span className="rounded border border-amber/40 px-1.5 py-px font-orbitron text-[9px] font-bold tracking-[.12em] text-amber">DEV</span>
            <span>{dev.version ? `v${dev.version}` : "Latest build"}</span>
            {devAgo && <span className="text-dim">{devAgo}</span>}
          </a>
        )}
      </div>
      <div>
        {p.others.length > 0 && (
          <details className="group mt-3 border-t border-line pt-2">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-hi hover:text-amber">
              Other formats ({p.others.length})
              <span aria-hidden className="plus text-[18px] leading-none text-brand transition-transform">+</span>
            </summary>
            <ul className="grid gap-1 pb-1">
              {p.others.map((d) => (
                <li key={d.url}>
                  <a href={d.url} download className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-[13px] text-amber no-underline hover:bg-white/5">
                    <span className="min-w-0">{d.label}</span>
                    {d.size > 0 && <span className="ml-auto flex-none text-[12px] tabular-nums text-dim">{formatSize(d.size)}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}

/**
 * The Download panel under the hero: folded away until a link to #download is followed (the
 * hero's button, the bar's), then it opens in place and the page scrolls to it. Without scripts
 * the link still opens it (CSS :target). `art`: the heading's drawing, drawn on the server so its
 * shapes never ship in this component's script.
 */
export default function DownloadPanel({ release, dev, platforms, fallback, art }: {
  release: LauncherRelease | null;
  dev: DevBuild | null;
  platforms: Platform[];
  fallback: string;
  art: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  // Known only in the browser: the server renders no system as the visitor's and no "3 days ago".
  const mine = useSyncExternalStore(noChange, browserPlatform, () => null);
  // The build may be newer than this page: the panel asks the server again when it opens.
  const [latest, setLatest] = useState<{ version: string; date: string } | null>(null);
  const devVersion = latest?.version ?? dev?.version ?? "";
  const devDate = latest?.date ?? dev?.date ?? "";
  const devAgo = useSyncExternalStore(noChange, () => (devDate ? ago(devDate) : ""), () => "");

  useEffect(() => {
    const show = () => {
      setOpen(true);
      // after the panel is laid out open, so the scroll lands on its top
      requestAnimationFrame(() => {
        ref.current?.scrollIntoView({ block: "start" });
        heading.current?.focus({ preventScroll: true });
      });
    };
    if (location.hash === "#download") show();
    // Captured before the link's own handler, so a Next <Link> to it does not navigate as well.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, location.href);
      if (url.hash !== "#download" || url.pathname !== location.pathname || url.origin !== location.origin) return;
      e.preventDefault();
      history.replaceState(null, "", "#download");
      show();
    };
    const onHash = () => location.hash === "#download" && show();
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!open || !dev) return;
    const ask = new AbortController();
    fetch("/download/dev", { signal: ask.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { version: string; date: string } | null) => d && setLatest(d))
      .catch(() => {});
    return () => ask.abort();
  }, [open, dev]);

  const close = () => {
    setOpen(false);
    history.replaceState(null, "", location.pathname + location.search);
    // back to the button that opened it, so the page does not slide away under the reader
    const button = document.getElementById("download-button");
    button?.focus({ preventScroll: true });
    if (button && button.getBoundingClientRect().top < 50) button.scrollIntoView({ block: "center" });
  };

  return (
    <section
      ref={ref}
      id="download"
      aria-labelledby="download-title"
      data-open={open}
      onKeyDown={(e) => e.key === "Escape" && open && close()}
      className="dl scroll-mt-[4px]"
    >
      <div className="dl-clip">
        <div className="dl-inner relative pb-10 pt-4 sm:pb-14">
          <div className="mb-2 flex items-center gap-3 sm:gap-5">
            {art}
            <h2
              id="download-title"
              ref={heading}
              tabIndex={-1}
              className="min-w-0 bg-gradient-to-r from-text to-soft bg-clip-text font-audiowide text-[clamp(26px,4vw,38px)] leading-tight text-transparent outline-none"
            >
              Get the launcher
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close downloads"
              className="ml-auto grid size-11 flex-none place-items-center rounded-full border border-line text-soft transition-colors hover:border-amber hover:text-amber"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-none stroke-current stroke-2">
                <path d="M3.5 3.5l9 9m0-9-9 9" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <p className="mb-6 max-w-[760px] text-dim sm:mb-8">Pick your system: the launcher sets each game up from your own disc. No game is downloaded.</p>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {platforms.map((p, i) => (
              <SystemCard
                key={p.id}
                p={p}
                i={i}
                mine={p.id === mine}
                release={release}
                dev={dev?.files[p.id] ? { version: devVersion, url: `/download/dev/${p.id}` } : null}
                devAgo={devAgo}
                fallback={fallback}
              />
            ))}
          </div>

          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-dim">
            <a href={release?.url || fallback} className="text-amber no-underline hover:underline">
              Release notes and every file on GitHub →
            </a>
            <span>Updates install from inside the launcher. DEV builds come from every merge to master and can be unstable.</span>
          </p>
        </div>
      </div>
    </section>
  );
}
