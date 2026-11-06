"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { preload } from "react-dom";
import HeroGalaxies from "@/components/ui/HeroGalaxies";
import { HERO_SHOTS, heroSrc } from "@/lib/heroShots";

const HOLD_MS = 14000; // each clip's time on screen (the 18 s clips, played at half speed, run on through the fade)
const FADE_MS = 1600; // the crossfade

const noChange = () => () => {};
// Asked for less motion, or to save data: the first frames only.
const stillOnly = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
const AV1 = 'video/webm; codecs="av01.0.08M.08"';

/**
 * A hidden log of what the clips do, for phones without dev tools: open the site once with
 * ?debug-hero and it stays on for the tab (sessionStorage), drawn bottom left. Off for everyone else.
 */
const debugLog: string[] = [];
const debugOn = () => {
  try {
    if (location.search.includes("debug-hero")) sessionStorage.setItem("debug-hero", "1");
    return sessionStorage.getItem("debug-hero") === "1";
  } catch {
    return false;
  }
};
const t0 = typeof performance === "undefined" ? 0 : performance.now();
function dbg(message: string) {
  if (typeof window === "undefined" || !debugOn()) return;
  debugLog.push(`${((performance.now() - t0) / 1000).toFixed(1)} ${location.pathname} ${message}`);
  if (debugLog.length > 40) debugLog.shift();
}
/** play() with the reason and the outcome in the debug log. */
function tryPlay(v: HTMLVideoElement, why: string) {
  dbg(`play ${why} clip=${v.dataset.clip} rs=${v.readyState} ns=${v.networkState} muted=${v.muted}/${v.hasAttribute("muted")}`);
  return v.play().then(
    () => dbg(`play ok ${why} clip=${v.dataset.clip}`),
    (e: Error) => {
      dbg(`play FAIL ${why} clip=${v.dataset.clip} ${e.name}: ${e.message}`);
      throw e;
    },
  );
}

function HeroDebug() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  if (!debugOn()) return null;
  const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-clip]")];
  return (
    <pre className="pointer-events-none fixed left-2 top-16 z-50 max-h-[55vh] max-w-[calc(100vw-16px)] overflow-auto whitespace-pre-wrap rounded bg-black/85 p-2 font-mono text-[10px] leading-tight text-[#9f9]">
      {videos.map((v) => `clip ${v.dataset.clip}: rs=${v.readyState} ns=${v.networkState} paused=${v.paused} t=${v.currentTime.toFixed(1)} err=${v.error?.code ?? "-"} op=${getComputedStyle(v).opacity} src=${v.currentSrc.split("/").pop() || "-"}`).join("\n")}
      {"\n---\n"}
      {debugLog.slice(-25).join("\n")}
    </pre>
  );
}

/**
 * Whether to play the AV1 files: only where they decode smoothly, and on a phone or tablet only in
 * hardware (a phone decoding AV1 in software drops frames and drains the battery); else the H.264
 * ones, which every device decodes in hardware. null until the browser has answered.
 */
function useAv1() {
  const [av1, setAv1] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const answer = navigator.mediaCapabilities
      ? navigator.mediaCapabilities
          .decodingInfo({ type: "file", video: { contentType: AV1, width: 1920, height: 1080, bitrate: 2_500_000, framerate: 60 } })
          .then((r) => r.supported && r.smooth && (r.powerEfficient || !matchMedia("(pointer: coarse)").matches))
      : Promise.resolve(document.createElement("video").canPlayType(AV1) === "probably");
    answer.then((ok) => live && setAv1(ok), () => live && setAv1(false));
    return () => {
      live = false;
    };
  }, []);
  return av1;
}


/** The clips and the galaxies melt into the page at the bottom: an eased mask, so no edge shows while scrolling past. */
const FADE_OUT = "[mask-image:linear-gradient(to_bottom,#000_50%,rgb(0_0_0/.82)_63%,rgb(0_0_0/.52)_75%,rgb(0_0_0/.24)_86%,rgb(0_0_0/.07)_94%,transparent)]";
/**
 * The title screen's clips: one full-bleed cinematic flight at a time, crossfading to the next like
 * a console's title screen. Under the text, a bar per clip fills while it shows (click one to jump).
 * Each clip's first frame shows while it loads, and alone with reduced motion; a clip not uploaded yet leaves the dark backdrop.
 */
function HeroShotLayers({ at, off, idle, hidden, missing, lost }: { at: number; off: boolean; idle: boolean; hidden: boolean; missing: ReadonlySet<number>; lost: (i: number) => void }) {
  // A clip loads once it is on screen or next: the others wait until their turn. The next one waits
  // until the first is playing, so on a slow line the first screen's picture comes first.
  const [warm, setWarm] = useState(false);
  const next = after(at, missing);
  const [wanted, setWanted] = useState(() => new Set([0]));
  if (!wanted.has(at) || (warm && !wanted.has(next))) setWanted(new Set([...wanted, at, ...(warm ? [next] : [])]));
  // The first clip's first frame is the first screen's biggest picture: fetched before the rest.
  preload(heroSrc(HERO_SHOTS[0], ".webp"), { as: "image", fetchPriority: "high" });
  const still = useSyncExternalStore(noChange, stillOnly, () => true);
  const av1 = useAv1();
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  // Whether the showing clip should be running now, read by the clips' own load events.
  const live = useRef({ at, run: false });
  useEffect(() => {
    live.current = { at, run: !off && !idle && !still };
  });

  // A clip's own load events start it when it is the one showing and should run (onLoadedData, onCanPlay).
  const startIfDue = (i: number) => (e: { currentTarget: HTMLVideoElement; type: string }) => {
    const v = e.currentTarget;
    if (i === live.current.at && live.current.run && v.paused) tryPlay(v, e.type).catch(() => {});
  };

  // The clip coming in starts from its beginning; the one going out stops once it has faded.
  useEffect(() => {
    const video = videos.current[at];
    dbg(`effect at=${at} off=${off} idle=${idle} still=${still} av1=${av1} video=${Boolean(video)}`);
    if (off || idle) {
      videos.current.forEach((v) => v?.pause());
      return;
    }
    // No play() before the files are in (the codec check): Safari drops a play() made on an empty clip.
    if (video && !still && av1 !== null) {
      // Files just added and not picked up yet: load them now, so the play() below waits for them
      // instead of being cancelled by their load (Safari otherwise keeps the first frame).
      if (video.readyState === HTMLMediaElement.HAVE_NOTHING && !video.currentSrc) {
        dbg(`load() clip=${at}`);
        video.load();
      }
      video.currentTime = 0;
      // A browser refusing autoplay (a phone saving power) keeps the first frame until the first touch or key.
      tryPlay(video, "effect").catch(() => {
        const retry = () => {
          const v = videos.current[live.current.at];
          if (live.current.run && v?.paused) tryPlay(v, "gesture").catch(() => {});
        };
        for (const type of ["pointerdown", "touchend", "keydown"]) addEventListener(type, retry, { once: true, passive: true });
      });
    }
    const stop = window.setTimeout(() => videos.current.forEach((v, i) => i !== at && v?.pause()), FADE_MS);
    return () => window.clearTimeout(stop);
  }, [at, still, off, idle, av1]);

  // A hidden tab holds the clip where it is (the clock waits too); back on the tab it plays on from there.
  // Only on a real change: on mount (coming back to the home page) the clip has no files yet, and a
  // play() then is the one iOS Safari drops, unlike the first visit where it never ran.
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current === hidden) return;
    wasHidden.current = hidden;
    const video = videos.current[live.current.at];
    if (hidden) video?.pause();
    else if (live.current.run && video?.paused) tryPlay(video, "tab back").catch(() => {});
  }, [hidden]);

  return (
    <div aria-hidden style={{ transitionDuration: `${FADE_MS}ms` }} className={`absolute inset-0 overflow-hidden bg-ink-deep transition-opacity ${FADE_OUT} ${off ? "opacity-0" : ""}`}>
      {HERO_SHOTS.map((shot, i) =>
        wanted.has(i) && !missing.has(i) ? (
          <video
            key={shot.file}
            ref={(v) => {
              videos.current[i] = v;
              // React sets muted only as a property on a clip it creates itself (coming back to the home page
              // without a reload), and iOS Safari then refuses to autoplay it: give it the real attribute too.
              if (v && !v.hasAttribute("muted")) {
                v.defaultMuted = true;
                v.muted = true;
                v.setAttribute("muted", "");
              }
            }}
            poster={heroSrc(shot, ".webp")}
            muted
            playsInline
            data-clip={i}
            onPlaying={() => {
              dbg(`playing clip=${i}`);
              setWarm(true);
            }}
            onPause={() => dbg(`paused clip=${i}`)}
            onEmptied={() => dbg(`emptied clip=${i}`)}
            onStalled={() => dbg(`stalled clip=${i}`)}
            onError={(e) => dbg(`video error clip=${i} code=${e.currentTarget.error?.code}`)}
            // Backups for a play() a browser dropped while the files loaded: start once there is a frame.
            onCanPlay={startIfDue(i)}
            onLoadedData={startIfDue(i)}
            // The browser's own autoplay starts the showing clip as soon as it has enough of it, the surest
            // way on phones; the calls above and onCanPlay only back it up.
            autoPlay={i === at && !still && !off && !idle}
            preload={i === at || i === next ? "auto" : "metadata"}
            style={{ transitionDuration: `${FADE_MS}ms` }}
            className={`absolute inset-0 size-full object-cover transition-opacity ease-out ${i === at ? "opacity-100" : "opacity-0"}`}
          >
            {/* The files come once the codec is chosen (the first frame shows meanwhile), so no clip loads twice. */}
            {av1 && <source src={heroSrc(shot, "-1080.webm")} type={AV1} />}
            {/* The last source failing too means the clip is not there: drop it. */}
            {av1 !== null && <source src={heroSrc(shot, "-1080.mp4")} type="video/mp4" onError={(e) => {
                  const v = e.currentTarget.parentElement as HTMLVideoElement;
                  dbg(`mp4 source error clip=${i} ns=${v.networkState} rs=${v.readyState} -> dropped`);
                  lost(i);
                }} />}
          </video>
        ) : null,
      )}
    </div>
  );
}

/** The clip after I, passing over the ones not uploaded (I itself when no other is there). */
function after(i: number, missing: ReadonlySet<number>) {
  for (let k = 1; k <= HERO_SHOTS.length; k++) {
    const j = (i + k) % HERO_SHOTS.length;
    if (!missing.has(j)) return j;
  }
  return i;
}

const onVisibility = (change: () => void) => {
  document.addEventListener("visibilitychange", change);
  return () => document.removeEventListener("visibilitychange", change);
};
/** Whether the browser tab is in the background. */
function useHidden() {
  return useSyncExternalStore(onVisibility, () => document.hidden, () => false);
}

/**
 * Which shot is showing: moves on by itself, jumps on a click. While the tab is hidden the clock
 * stops; back on the tab it runs on for the time left, in step with the clip and its bar.
 */
function useHeroShot(missing: ReadonlySet<number>, paused: boolean) {
  const [at, setAt] = useState(0);
  const [round, setRound] = useState(0); // bumped by a click, so the timer starts over
  const hidden = useHidden();
  const spent = useRef(0); // time the showing clip has been on screen so far
  useEffect(() => {
    spent.current = 0;
  }, [at, round, paused]);
  useEffect(() => {
    if (hidden || paused) return;
    const start = performance.now();
    const timer = window.setTimeout(() => setAt((i) => after(i, missing)), Math.max(0, HOLD_MS - spent.current));
    return () => {
      window.clearTimeout(timer);
      spent.current += performance.now() - start;
    };
  }, [at, round, missing, paused, hidden]);
  return {
    at,
    round,
    hidden,
    go: (i: number) => {
      setAt(i);
      setRound((r) => r + 1);
    },
  };
}

/** A bar per clip: the showing one fills over its time; a click jumps to that clip. */
function HeroShotBar({ at, round, go, missing, hidden }: { at: number; round: number; go: (i: number) => void; missing: ReadonlySet<number>; hidden: boolean }) {
  return (
    <div className="mt-6 max-[700px]:mt-10">
      <div className="-ml-1.5 flex max-[700px]:ml-0 max-[700px]:justify-center" role="group" aria-label="Clips">
        {HERO_SHOTS.map((shot, i) => missing.has(i) ? null : (
          <button
            key={shot.file}
            type="button"
            aria-label={`${shot.game}, clip ${i + 1}`}
            aria-current={i === at}
            onClick={() => go(i)}
            // A 40 px hit area (fingers) around the 4 px bar it draws.
            className="group flex size-10 cursor-pointer items-center px-1.5 sm:w-12"
          >
            <span className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-colors group-hover:bg-white/35">
              {i === at && (
                <span key={`${at}-${round}`} style={{ animationDuration: `${HOLD_MS}ms`, animationPlayState: hidden ? "paused" : "running" }} className="absolute inset-y-0 left-0 w-full origin-left animate-[shot-fill_linear_forwards] rounded-full bg-amber motion-reduce:animate-none" />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
// On a touch screen the same code is swipes, with two taps for B and A.
const SWIPES = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "tap", "tap"];

/** Calls ON each time the Konami code is entered: on the keyboard, or as swipes and taps on a touch screen. */
function useKonami(on: () => void) {
  const latest = useRef(on);
  useEffect(() => {
    latest.current = on;
  });
  useEffect(() => {
    let keys: string[] = [];
    let swipes: string[] = [];
    let start: { x: number; y: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable],dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
      keys = [...keys, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-KONAMI.length);
      if (keys.join() === KONAMI.join()) {
        keys = [];
        latest.current();
      }
    };
    const onStart = (e: TouchEvent) => {
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      const far = Math.max(Math.abs(dx), Math.abs(dy));
      // A swipe is the finger's way: up is ArrowUp. Anything between a tap and a swipe starts over.
      const move = far < 10 ? "tap" : far < 40 ? "" : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : dy > 0 ? "ArrowDown" : "ArrowUp";
      swipes = move ? [...swipes, move].slice(-SWIPES.length) : [];
      if (swipes.join() === SWIPES.join()) {
        swipes = [];
        latest.current();
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("touchstart", onStart, { passive: true });
    addEventListener("touchend", onEnd, { passive: true });
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("touchstart", onStart);
      removeEventListener("touchend", onEnd);
    };
  }, []);
}

/**
 * The home page's first screen, edge to edge under the bar: the clips, a dark fade on the left and
 * bottom for the text, the corner HUD, then the text (children) bottom left with the bar under it.
 * The Konami code swaps the clips for the series' galaxies (HeroGalaxies) and back.
 */
export default function HeroStage({ hud, children }: { hud: ReactNode; children: ReactNode }) {
  // Clips not uploaded (yet) drop out of the turn and the bar.
  const [missing, setMissing] = useState<ReadonlySet<number>>(() => new Set());
  const [sky, setSky] = useState(false);
  useKonami(() => setSky((on) => !on));
  // Scrolled out of view: the clips stop and the turn waits; back in view, the clip starts over.
  const stage = useRef<HTMLElement>(null);
  const [idle, setIdle] = useState(false);
  const { at, round, hidden, go } = useHeroShot(missing, sky || idle);
  const resume = useRef(() => {});
  useEffect(() => {
    resume.current = () => go(at);
  });
  useEffect(() => {
    dbg("stage mounted");
    const io = new IntersectionObserver(([e]) => {
      dbg(`in view=${e.isIntersecting}`);
      setIdle(!e.isIntersecting);
      if (e.isIntersecting) resume.current();
    });
    if (stage.current) io.observe(stage.current);
    return () => io.disconnect();
  }, []);
  const lost = (i: number) => {
    const now = new Set([...missing, i]);
    setMissing(now);
    if (i === at && now.size < HERO_SHOTS.length) go(after(at, now)); // no dark wait for a missing first clip
  };
  // Pulled up under the bar's place (-mt-[50px]), so the clip shows around the floating bar at the top.
  return (
    <section ref={stage} className="relative mx-[calc(50%-50vw)] -mt-[50px] flex min-h-svh items-end">
      <HeroDebug />
      <HeroShotLayers at={at} off={sky} idle={idle} hidden={hidden} missing={missing} lost={lost} />
      {sky && (
        <div className={`absolute inset-0 animate-[sky-in_1.6s_ease-out_both] ${FADE_OUT}`}>
          <HeroGalaxies />
        </div>
      )}
      <div aria-hidden className={`absolute inset-0 transition-opacity duration-[1600ms] ${sky ? "opacity-60" : ""} bg-[linear-gradient(0deg,var(--color-ink)_0%,rgb(10_10_10/.6)_14%,rgb(10_10_10/.25)_30%,transparent_45%),linear-gradient(90deg,rgb(5_5_5/.92)_0%,rgb(5_5_5/.55)_45%,transparent_75%)] max-[700px]:bg-[linear-gradient(0deg,var(--color-ink)_8%,rgb(5_5_5/.82)_55%,rgb(5_5_5/.35)_100%)]`} />
      {hud}
      {/* Phones: centred, with wider side margins; wider screens: bottom left. */}
      <div className="relative mx-auto w-full max-w-[1080px] px-4 pb-14 pt-40 max-[700px]:px-7 max-[700px]:pb-24 max-[700px]:text-center max-[700px]:[&>*]:mx-auto">
        {children}
        {sky ? (
          <p className="mt-7 font-mono text-[12px] font-semibold tracking-[.04em] text-soft">
            <span className="text-gold">The series&apos; galaxies</span> · enter the code again to go back
          </p>
        ) : (
          missing.size < HERO_SHOTS.length && <HeroShotBar at={at} round={round} go={go} missing={missing} hidden={hidden} />
        )}
      </div>
    </section>
  );
}
