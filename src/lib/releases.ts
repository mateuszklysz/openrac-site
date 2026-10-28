/** The launcher's repository: its releases are what the Download panel offers. */
const LAUNCHER_REPO = "OpenRAC/OpenRAC";

export type PlatformId = "windows" | "macos" | "linux" | "android";

/** One file of a release a player can install. */
export interface Download {
  /** What it is, as a player reads it: "Installer (.exe)", "AppImage · ARM64". */
  label: string;
  url: string;
  size: number;
}

/** One system's column in the Download panel: its main file first, the other formats after. */
export interface Platform {
  id: PlatformId;
  name: string;
  /** The systems and devices it runs on, a short line each. */
  supports: string[];
  main: Download | null;
  others: Download[];
}

export interface LauncherRelease {
  version: string;
  /** When it was published, ISO 8601. */
  date: string;
  url: string;
  platforms: Platform[];
}

/** The part of GitHub's release object that is read here. */
export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

const PLATFORMS: { id: PlatformId; name: string }[] = [
  { id: "windows", name: "Windows" },
  { id: "linux", name: "Linux" },
  { id: "macos", name: "macOS" },
  { id: "android", name: "Android" },
];

/**
 * What each system needs, from the launcher's build (OpenRAC's .github/workflows/launcher.yml):
 * Windows x64; Linux built on Ubuntu 22.04, so glibc 2.35 or later; the macOS game is Apple
 * silicon's; Android 9 (minSdk 28) is the launcher's floor.
 */
const SUPPORTS: Record<PlatformId, string[]> = {
  windows: ["Windows 10 and 11", "64-bit PCs (x64)"],
  linux: ["Ubuntu 22.04, Debian 12, Fedora 36, SteamOS or newer", "x86-64 and ARM64"],
  macos: ["Macs with Apple silicon (M1 or newer)"],
  android: ["Android 9 or newer", "64-bit ARM phones and handhelds", "Mali or Adreno GPU with OpenGL ES 3.2"],
};

const arch = (name: string) => (/aarch64|arm64/i.test(name) ? "ARM64" : "x86-64");

/**
 * Which system a file is for and how it is named, or null for what a player never installs
 * by hand: signatures, the updater's manifest and its archives.
 * The names are the ones Tauri's bundler gives them: OpenRAC.Launcher_0.9.0_x64-setup.exe,
 * …_amd64.AppImage, …-1.fc44.x86_64.rpm, …_android-arm64-debug.apk.
 */
export function classify(name: string): { platform: PlatformId; label: string; rank: number } | null {
  if (/\.sig$|\.json$|\.tar\.gz$|\.zip$/i.test(name)) return null;
  if (/-setup\.exe$/i.test(name)) return { platform: "windows", label: "Installer (.exe)", rank: 0 };
  if (/\.msi$/i.test(name)) return { platform: "windows", label: "Windows Installer (.msi)", rank: 1 };
  if (/\.dmg$/i.test(name)) return { platform: "macos", label: "Disk image (.dmg)", rank: 0 };
  if (/\.apk$/i.test(name)) return { platform: "android", label: "APK · 64-bit ARM", rank: 0 };
  const arm = arch(name) === "ARM64" ? 10 : 0;
  if (/\.AppImage$/i.test(name)) return { platform: "linux", label: `AppImage · ${arch(name)}`, rank: 0 + arm };
  if (/\.deb$/i.test(name)) return { platform: "linux", label: `.deb (Debian, Ubuntu) · ${arch(name)}`, rank: 1 + arm };
  if (/\.fc\d+\.[^.]+\.rpm$/i.test(name)) return { platform: "linux", label: `.rpm for Fedora · ${arch(name)}`, rank: 2 + arm };
  if (/\.rpm$/i.test(name)) return { platform: "linux", label: `.rpm · ${arch(name)}`, rank: 3 + arm };
  return null;
}

/** The newest published launcher release: not a draft, not a development build, tagged `launcher-v…`. */
export function pickLatest(releases: GithubRelease[]): GithubRelease | null {
  return releases.find((r) => !r.draft && !r.prerelease && r.tag_name.startsWith("launcher-v")) ?? null;
}

/** A release as the Download panel shows it: one entry per system, in a fixed order, even one without files. */
export function toLauncherRelease(release: GithubRelease): LauncherRelease {
  const files = release.assets
    .flatMap((a) => {
      const c = classify(a.name);
      return c ? [{ ...c, download: { label: c.label, url: a.browser_download_url, size: a.size } }] : [];
    })
    .sort((a, b) => a.rank - b.rank);
  return {
    version: release.tag_name.replace(/^launcher-v/, ""),
    date: release.published_at ?? "",
    url: release.html_url,
    platforms: PLATFORMS.map(({ id, name }) => {
      const [main = null, ...others] = files.filter((f) => f.platform === id).map((f) => f.download);
      return { id, name, supports: SUPPORTS[id], main, others };
    }),
  };
}

/** The newest development build: what CI publishes from every merge to master, one main file per system. */
export interface DevBuild {
  version: string;
  /** When it was published, ISO 8601. */
  date: string;
  url: string;
  files: Partial<Record<PlatformId, Download>>;
}

/** The pre-release the launcher workflow replaces on every push to master (its docs/RELEASING.md). */
const DEV_TAG = "launcher-dev-master";
export const DEV_PAGE = `https://github.com/${LAUNCHER_REPO}/releases/tag/${DEV_TAG}`;

/** The updater's manifest each launcher build publishes beside its files (OpenRAC's tools/updater_manifest.py). */
export interface UpdaterManifest {
  version: string;
  pub_date?: string;
  platforms: Record<string, { url: string }>;
}

/**
 * A build's updater manifest read as a release: every file it names, plus the Mac's disk image,
 * which the manifest leaves out (a Mac updates from the app archive) and which keeps the build's
 * X.Y.Z in its name. Sizes are not in the manifest (0).
 */
export function manifestRelease(manifest: UpdaterManifest, tag: string): GithubRelease {
  const urls = new Set(Object.values(manifest.platforms).map((p) => p.url));
  const mac = manifest.platforms["darwin-aarch64-app"]?.url;
  if (mac) urls.add(mac.replace(/[^/]+$/, `OpenRAC.Launcher_${manifest.version.replace(/-.*/, "")}_universal.dmg`));
  return {
    tag_name: tag,
    html_url: `https://github.com/${LAUNCHER_REPO}/releases/tag/${tag}`,
    published_at: manifest.pub_date ?? null,
    draft: false,
    prerelease: false,
    assets: [...urls].map((url) => ({ name: decodeURIComponent(url.split("/").pop() ?? ""), browser_download_url: url, size: 0 })),
  };
}

/**
 * The development build as the panel shows it, from its updater manifest: the version and time of
 * this very build, and each system's main file. The manifest is rewritten with every build, while
 * the release's own date stays the day it was first made, and the APK's name changes with every
 * build ("…_0.9.1-dev.488_android-arm64-debug.apk").
 */
export function devFromManifest(manifest: UpdaterManifest): DevBuild {
  const files: DevBuild["files"] = {};
  for (const p of toLauncherRelease(manifestRelease(manifest, DEV_TAG)).platforms) if (p.main) files[p.id] = p.main;
  return { version: manifest.version, date: manifest.pub_date ?? "", url: DEV_PAGE, files };
}

/** Every system with no file: what the panel shows when GitHub cannot be reached. */
export const noFiles = (): Platform[] =>
  toLauncherRelease({ tag_name: "", html_url: "", published_at: null, draft: false, prerelease: false, assets: [] }).platforms;

/** GitHub's API, read on the server and cached for five minutes (the home page is rebuilt as often), so a new build shows without redeploying the site. Null if unreachable. */
async function github<T>(path: string): Promise<T | null> {
  const headers: HeadersInit = { Accept: "application/vnd.github+json" };
  // Optional, only raises the rate limit. Never sent to the browser.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${LAUNCHER_REPO}/${path}`, { headers, next: { revalidate: 300 }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// The last answers GitHub gave, kept by the running server: a refresh that fails (the API's rate
// limit, a timeout) shows them again instead of a panel with no files until the next refresh.
let lastRelease: LauncherRelease | null = null;
let lastDev: DevBuild | null = null;

/** A build's updater manifest, a release download (not the API, so outside its rate limit). Null if unreachable. */
async function manifest(path: string, revalidate: number): Promise<UpdaterManifest | null> {
  try {
    const res = await fetch(`https://github.com/${LAUNCHER_REPO}/releases/${path}/latest.json`, { next: { revalidate }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as UpdaterManifest) : null;
  } catch {
    return null;
  }
}

/**
 * The latest launcher release. From the API, which lists every file with its size; when the API
 * does not answer (its rate limit, a timeout), from the release's updater manifest, which names
 * the same main files without sizes; else the last one read; null before any.
 */
export async function getLauncherRelease(): Promise<LauncherRelease | null> {
  const releases = await github<GithubRelease[]>("releases?per_page=30");
  const release = releases && pickLatest(releases);
  if (release) return (lastRelease = toLauncherRelease(release));
  const latest = await manifest("latest/download", 300);
  if (latest) lastRelease = toLauncherRelease(manifestRelease(latest, `launcher-v${latest.version}`));
  return lastRelease;
}

/**
 * The latest development build from master, read from its updater manifest and cached for a
 * minute; the last one read if GitHub does not answer now; null before any.
 */
export async function getDevBuild(): Promise<DevBuild | null> {
  const latest = await manifest(`download/${DEV_TAG}`, 60);
  if (latest) lastDev = devFromManifest(latest);
  return lastDev;
}
