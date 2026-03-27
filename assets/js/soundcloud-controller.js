import {
  AUTOPLAY_BLOCKED_MESSAGE,
  MEDIA_STATUSES,
  SOUNDCLOUD_EMBED_BASE,
  SOUNDCLOUD_WIDGET_SCRIPT_SRC,
} from "./config.js";

const VALID_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"]);

let widgetApiPromise;

export function normalizeSoundCloudUrl(input) {
  if (typeof input !== "string") {
    return "";
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch (error) {
    return "";
  }

  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    return "";
  }

  if (!VALID_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    return "";
  }

  parsedUrl.protocol = "https:";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

export function isLikelySoundCloudUrl(input) {
  return Boolean(normalizeSoundCloudUrl(input));
}

export function detectSoundCloudUrlKind(input) {
  const normalizedUrl = normalizeSoundCloudUrl(input);
  if (!normalizedUrl) {
    return null;
  }

  const pathname = new URL(normalizedUrl).pathname.toLowerCase();
  if (pathname.includes("/sets/")) {
    return "playlist";
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return "track";
  }

  return "unknown";
}

export function createSoundCloudEmbedUrl(input, { autoPlay = false } = {}) {
  const normalizedUrl = normalizeSoundCloudUrl(input);
  if (!normalizedUrl) {
    throw new Error("Paste a valid SoundCloud track or playlist URL.");
  }

  const params = new URLSearchParams({
    url: normalizedUrl,
    auto_play: autoPlay ? "true" : "false",
    buying: "false",
    download: "false",
    hide_related: "true",
    sharing: "false",
    show_artwork: "false",
    show_comments: "false",
    show_playcount: "false",
    show_reposts: "false",
    show_teaser: "false",
    show_user: "true",
    visual: "false",
  });

  return `${SOUNDCLOUD_EMBED_BASE}?${params.toString()}`;
}

export function createSoundCloudSnapshot(overrides = {}) {
  return {
    url: "",
    normalizedUrl: "",
    kind: "unknown",
    title: "",
    author: "",
    status: MEDIA_STATUSES.idle,
    volume: 65,
    currentPositionMs: 0,
    currentIndex: 0,
    durationMs: 0,
    canGoNext: false,
    canGoPrevious: false,
    shouldResumeOnFocus: false,
    autoplayBlocked: false,
    lastError: "",
    loadedAt: null,
    ...overrides,
  };
}

export class SoundCloudController {
  constructor({ iframe, placeholderElement = null, onSnapshot = () => {}, onError = () => {} } = {}) {
    this.iframe = iframe;
    this.placeholderElement = placeholderElement;
    this.onSnapshot = onSnapshot;
    this.onError = onError;
    this.widget = null;
    this.currentSource = null;
    this.snapshot = createSoundCloudSnapshot();
    this.loadToken = 0;
  }

  async load(url, { autoplay = false, restorePositionMs = 0, volume = 65 } = {}) {
    const normalizedUrl = normalizeSoundCloudUrl(url);
    if (!normalizedUrl) {
      throw new Error("Paste a valid SoundCloud track or playlist URL.");
    }

    if (!this.iframe) {
      throw new Error("The SoundCloud player could not be mounted.");
    }

    await this.ensureWidgetApi();

    const loadToken = ++this.loadToken;
    this.currentSource = {
      url: normalizedUrl,
      kind: detectSoundCloudUrlKind(normalizedUrl) || "unknown",
    };

    this.snapshot = createSoundCloudSnapshot({
      url: normalizedUrl,
      normalizedUrl,
      kind: this.currentSource.kind,
      status: MEDIA_STATUSES.loading,
      volume: clampPercent(volume),
      loadedAt: Date.now(),
    });
    this.publishSnapshot("load-start");
    this.setPlaceholderVisible(false);
    this.iframe.src = createSoundCloudEmbedUrl(normalizedUrl, { autoPlay: false });
    this.widget = window.SC.Widget(this.iframe);

    await this.waitForReady(loadToken);
    await this.setVolume(volume);

    if (restorePositionMs > 0) {
      await this.seekTo(restorePositionMs);
    }

    if (autoplay) {
      return this.play({ userInitiated: false });
    }

    const snapshot = await this.captureSnapshot({
      status: MEDIA_STATUSES.paused,
      autoplayBlocked: false,
      lastError: "",
    });
    this.publishSnapshot("load-complete", snapshot);
    return snapshot;
  }

  async play({ userInitiated = false } = {}) {
    if (!this.widget || !this.currentSource) {
      return this.snapshot;
    }

    try {
      this.widget.play();
    } catch (error) {
      return this.fail("The SoundCloud widget could not start playback.");
    }

    const didStart = await this.waitForPlaybackState("playing", 1800);
    const snapshot = await this.captureSnapshot({
      status: didStart ? MEDIA_STATUSES.playing : MEDIA_STATUSES.paused,
      autoplayBlocked: !didStart && !userInitiated,
      lastError: !didStart && !userInitiated ? AUTOPLAY_BLOCKED_MESSAGE : "",
    });
    this.publishSnapshot("play-command", snapshot);

    if (!didStart && !userInitiated) {
      this.onError(AUTOPLAY_BLOCKED_MESSAGE);
    }

    return snapshot;
  }

  async pause() {
    if (!this.widget || !this.currentSource) {
      return this.snapshot;
    }

    try {
      this.widget.pause();
    } catch (error) {
      return this.fail("The SoundCloud widget could not pause playback.");
    }

    await this.waitForPlaybackState("paused", 1200);
    const snapshot = await this.captureSnapshot({
      status: MEDIA_STATUSES.paused,
      autoplayBlocked: false,
      lastError: "",
    });
    this.publishSnapshot("pause-command", snapshot);
    return snapshot;
  }

  async next() {
    const snapshot = await this.captureSnapshot();
    if (!snapshot.canGoNext || !this.widget) {
      return snapshot;
    }

    try {
      if (typeof this.widget.next === "function") {
        this.widget.next();
      } else if (typeof this.widget.skip === "function") {
        this.widget.skip(snapshot.currentIndex + 1);
      }
    } catch (error) {
      return this.fail("The SoundCloud widget could not move to the next item.");
    }

    await wait(800);
    const nextSnapshot = await this.captureSnapshot({
      status: MEDIA_STATUSES.playing,
      autoplayBlocked: false,
      lastError: "",
    });
    this.publishSnapshot("next-command", nextSnapshot);
    return nextSnapshot;
  }

  async previous() {
    const snapshot = await this.captureSnapshot();
    if (!snapshot.canGoPrevious || !this.widget) {
      return snapshot;
    }

    try {
      if (typeof this.widget.prev === "function") {
        this.widget.prev();
      } else if (typeof this.widget.skip === "function") {
        this.widget.skip(Math.max(0, snapshot.currentIndex - 1));
      }
    } catch (error) {
      return this.fail("The SoundCloud widget could not move to the previous item.");
    }

    await wait(800);
    const previousSnapshot = await this.captureSnapshot({
      status: MEDIA_STATUSES.playing,
      autoplayBlocked: false,
      lastError: "",
    });
    this.publishSnapshot("previous-command", previousSnapshot);
    return previousSnapshot;
  }

  async seekTo(ms) {
    if (!this.widget || !this.currentSource) {
      return this.snapshot;
    }

    try {
      this.widget.seekTo(Math.max(0, Math.floor(ms)));
    } catch (error) {
      return this.fail("The SoundCloud widget could not seek.");
    }

    await wait(250);
    return this.captureSnapshot();
  }

  async setVolume(percent) {
    const safeVolume = clampPercent(percent);
    this.snapshot = createSoundCloudSnapshot({
      ...this.snapshot,
      volume: safeVolume,
    });

    if (!this.widget) {
      return this.snapshot;
    }

    try {
      this.widget.setVolume(safeVolume);
    } catch (error) {
      return this.fail("The SoundCloud widget could not change volume.");
    }

    return this.captureSnapshot({ volume: safeVolume });
  }

  async captureSnapshot(overrides = {}) {
    if (!this.currentSource) {
      this.snapshot = createSoundCloudSnapshot({
        ...this.snapshot,
        ...overrides,
      });
      return this.snapshot;
    }

    if (!this.widget) {
      return createSoundCloudSnapshot({
        ...this.snapshot,
        ...overrides,
      });
    }

    const [currentSound, sounds, currentIndex, position, duration, volume, isPaused] = await Promise.all([
      this.readWidgetValue("getCurrentSound"),
      this.readWidgetValue("getSounds"),
      this.readWidgetValue("getCurrentSoundIndex"),
      this.readWidgetValue("getPosition"),
      this.readWidgetValue("getDuration"),
      this.readWidgetValue("getVolume"),
      this.readWidgetValue("isPaused"),
    ]);

    const soundList = Array.isArray(sounds) ? sounds : currentSound ? [currentSound] : [];
    const safeIndex = Number.isFinite(currentIndex) ? Math.max(0, Math.floor(currentIndex)) : 0;
    const status =
      overrides.status ||
      (typeof isPaused === "boolean" ? (isPaused ? MEDIA_STATUSES.paused : MEDIA_STATUSES.playing) : this.snapshot.status);

    this.snapshot = createSoundCloudSnapshot({
      ...this.snapshot,
      url: this.currentSource.url,
      normalizedUrl: this.currentSource.url,
      kind: this.currentSource.kind,
      title: currentSound?.title || this.snapshot.title || "",
      author: currentSound?.user?.username || this.snapshot.author || "",
      status,
      volume: clampPercent(Number.isFinite(volume) ? volume : overrides.volume ?? this.snapshot.volume),
      currentPositionMs: Number.isFinite(position) ? Math.max(0, position) : this.snapshot.currentPositionMs,
      currentIndex: safeIndex,
      durationMs: Number.isFinite(duration)
        ? Math.max(0, duration)
        : Number.isFinite(currentSound?.duration)
          ? Math.max(0, currentSound.duration)
          : this.snapshot.durationMs,
      canGoNext: soundList.length > 1 && safeIndex < soundList.length - 1,
      canGoPrevious: soundList.length > 1 && safeIndex > 0,
      autoplayBlocked: Boolean(overrides.autoplayBlocked),
      lastError: typeof overrides.lastError === "string" ? overrides.lastError : "",
      loadedAt: this.snapshot.loadedAt || Date.now(),
    });

    return this.snapshot;
  }

  clear() {
    this.loadToken += 1;
    this.widget = null;
    this.currentSource = null;
    if (this.iframe) {
      this.iframe.removeAttribute("src");
    }
    this.setPlaceholderVisible(true);
    this.snapshot = createSoundCloudSnapshot({
      volume: this.snapshot.volume,
    });
    this.publishSnapshot("clear");
    return this.snapshot;
  }

  async ensureWidgetApi() {
    if (window.SC?.Widget) {
      return window.SC.Widget;
    }

    if (!widgetApiPromise) {
      widgetApiPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-soundcloud-widget-api="true"]');
        const timeoutId = window.setTimeout(() => {
          reject(new Error("The SoundCloud widget took too long to load."));
        }, 12000);

        const handleLoad = () => {
          if (window.SC?.Widget) {
            window.clearTimeout(timeoutId);
            resolve(window.SC.Widget);
            return;
          }

          window.setTimeout(handleLoad, 80);
        };

        if (existingScript) {
          existingScript.addEventListener("load", handleLoad, { once: true });
          existingScript.addEventListener(
            "error",
            () => {
              window.clearTimeout(timeoutId);
              reject(new Error("The SoundCloud widget script could not be loaded."));
            },
            { once: true },
          );
          handleLoad();
          return;
        }

        const script = document.createElement("script");
        script.src = SOUNDCLOUD_WIDGET_SCRIPT_SRC;
        script.async = true;
        script.dataset.soundcloudWidgetApi = "true";
        script.addEventListener("load", handleLoad, { once: true });
        script.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeoutId);
            reject(new Error("The SoundCloud widget script could not be loaded."));
          },
          { once: true },
        );
        document.head.append(script);
      });
    }

    return widgetApiPromise;
  }

  waitForReady(loadToken) {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("The SoundCloud widget could not load that URL."));
      }, 12000);

      const events = window.SC.Widget.Events;
      this.widget.bind(events.READY, async () => {
        if (loadToken !== this.loadToken) {
          return;
        }

        window.clearTimeout(timeoutId);
        const snapshot = await this.captureSnapshot({
          status: MEDIA_STATUSES.ready,
          autoplayBlocked: false,
          lastError: "",
        });
        this.publishSnapshot("ready", snapshot);
        resolve(snapshot);
      });

      this.widget.bind(events.PLAY, () => {
        void this.publishFromEvent("play", { status: MEDIA_STATUSES.playing });
      });

      this.widget.bind(events.PAUSE, () => {
        void this.publishFromEvent("pause", { status: MEDIA_STATUSES.paused });
      });

      this.widget.bind(events.FINISH, () => {
        void this.publishFromEvent("finish", { status: MEDIA_STATUSES.ended });
      });
    });
  }

  async publishFromEvent(reason, overrides = {}) {
    const snapshot = await this.captureSnapshot({
      autoplayBlocked: false,
      lastError: "",
      ...overrides,
    });
    this.publishSnapshot(reason, snapshot);
    return snapshot;
  }

  publishSnapshot(reason, snapshot = this.snapshot) {
    this.snapshot = snapshot;
    this.onSnapshot(snapshot, { reason });
  }

  async waitForPlaybackState(target, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const paused = await this.readWidgetValue("isPaused");
      if (typeof paused === "boolean") {
        if (target === "playing" && paused === false) {
          return true;
        }

        if (target === "paused" && paused === true) {
          return true;
        }
      }

      await wait(120);
    }

    return false;
  }

  async readWidgetValue(methodName) {
    if (!this.widget || typeof this.widget[methodName] !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      try {
        this.widget[methodName]((value) => resolve(value));
      } catch (error) {
        resolve(null);
      }
    });
  }

  setPlaceholderVisible(isVisible) {
    if (!this.placeholderElement) {
      return;
    }

    this.placeholderElement.classList.toggle("hidden", !isVisible);
  }

  async fail(message) {
    this.snapshot = createSoundCloudSnapshot({
      ...this.snapshot,
      status: MEDIA_STATUSES.error,
      autoplayBlocked: false,
      lastError: message,
    });
    this.publishSnapshot("error", this.snapshot);
    this.onError(message);
    return this.snapshot;
  }
}

function clampPercent(value) {
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) {
    return 65;
  }
  return Math.min(100, Math.max(0, numericValue));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
