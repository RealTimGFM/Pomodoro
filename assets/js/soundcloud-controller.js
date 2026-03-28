import {
  AUTOPLAY_BLOCKED_MESSAGE,
  MEDIA_STATUSES,
  SOUNDCLOUD_EMBED_BASE,
  SOUNDCLOUD_WIDGET_SCRIPT_SRC,
} from "./config.js";

const VALID_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"]);
const TRACKING_PARAMS = new Set(["si", "fbclid", "gclid", "mc_cid", "mc_eid"]);
const READY_TIMEOUT_MS = 20000;
const PLAY_TIMEOUT_MS = 6000;
const PAUSE_TIMEOUT_MS = 2500;
const NAV_SETTLE_MS = 1200;

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

  if (parsedUrl.hostname.toLowerCase() === "on.soundcloud.com") {
    for (const key of [...parsedUrl.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_PARAMS.has(key)) {
        parsedUrl.searchParams.delete(key);
      }
    }
  } else {
    parsedUrl.search = "";
  }

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
    this.listenersBound = false;
    this.pendingReady = null;
    this.pendingWidgetError = "";
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
    this.pendingWidgetError = "";
    this.currentSource = {
      url: normalizedUrl,
      kind: detectSoundCloudUrlKind(normalizedUrl) || "unknown",
    };

    this.snapshot = createSoundCloudSnapshot({
      ...this.snapshot,
      url: normalizedUrl,
      normalizedUrl,
      kind: this.currentSource.kind,
      status: MEDIA_STATUSES.loading,
      volume: clampPercent(volume),
      autoplayBlocked: false,
      lastError: "",
      loadedAt: Date.now(),
    });
    this.publishSnapshot("load-start");
    this.setPlaceholderVisible(false);

    if (!this.widget) {
      await this.bootstrapWidget(normalizedUrl, loadToken);
    } else {
      await this.reloadWidget(normalizedUrl, loadToken);
    }

    if (loadToken !== this.loadToken) {
      return this.snapshot;
    }

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

    this.pendingWidgetError = "";

    try {
      this.widget.play();
    } catch (error) {
      return this.fail("The SoundCloud widget could not start playback.");
    }

    const didStart = await this.waitForPlaybackState("playing", PLAY_TIMEOUT_MS);

    const lastError = didStart
      ? ""
      : !userInitiated
        ? AUTOPLAY_BLOCKED_MESSAGE
        : this.pendingWidgetError || "Playback did not start. Open the player and press play once.";

    const snapshot = await this.captureSnapshot({
      status: didStart ? MEDIA_STATUSES.playing : MEDIA_STATUSES.paused,
      autoplayBlocked: !didStart && !userInitiated,
      lastError,
    });

    this.publishSnapshot("play-command", snapshot);

    if (!didStart && lastError) {
      this.onError(lastError);
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

    await this.waitForPlaybackState("paused", PAUSE_TIMEOUT_MS);
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

    await wait(NAV_SETTLE_MS);
    const nextSnapshot = await this.captureSnapshot({
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

    await wait(NAV_SETTLE_MS);
    const previousSnapshot = await this.captureSnapshot({
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

    await wait(300);
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
      this.snapshot = createSoundCloudSnapshot({
        ...this.snapshot,
        ...overrides,
      });
      return this.snapshot;
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
    const derivedStatus =
      typeof isPaused === "boolean"
        ? isPaused
          ? MEDIA_STATUSES.paused
          : MEDIA_STATUSES.playing
        : this.snapshot.status;

    const status = Object.prototype.hasOwnProperty.call(overrides, "status")
      ? overrides.status
      : derivedStatus;

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
      autoplayBlocked: Object.prototype.hasOwnProperty.call(overrides, "autoplayBlocked")
        ? Boolean(overrides.autoplayBlocked)
        : this.snapshot.autoplayBlocked,
      lastError: Object.prototype.hasOwnProperty.call(overrides, "lastError")
        ? `${overrides.lastError || ""}`
        : this.snapshot.lastError,
      loadedAt: this.snapshot.loadedAt || Date.now(),
    });

    return this.snapshot;
  }

  clear() {
    this.loadToken += 1;
    this.pendingWidgetError = "";
    this.clearPendingReady();
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
        }, READY_TIMEOUT_MS);

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

  async bootstrapWidget(normalizedUrl, loadToken) {
    const readyPromise = this.createReadyPromise(loadToken);
    this.iframe.src = createSoundCloudEmbedUrl(normalizedUrl, { autoPlay: false });
    this.widget = window.SC.Widget(this.iframe);
    this.bindWidgetEvents();
    await readyPromise;
  }

  async reloadWidget(normalizedUrl, loadToken) {
    if (!this.widget) {
      throw new Error("The SoundCloud widget could not be mounted.");
    }

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        reject(new Error("The SoundCloud widget could not load that URL."));
      }, READY_TIMEOUT_MS);

      try {
        this.widget.load(normalizedUrl, {
          auto_play: false,
          callback: () => {
            if (loadToken !== this.loadToken) {
              return;
            }
            window.clearTimeout(timeoutId);
            resolve(true);
          },
        });
      } catch (error) {
        window.clearTimeout(timeoutId);
        reject(new Error("The SoundCloud widget could not load that URL."));
      }
    });
  }

  bindWidgetEvents() {
    if (!this.widget || this.listenersBound) {
      return;
    }

    const events = window.SC.Widget.Events;

    this.widget.bind(events.READY, () => {
      this.resolveReady();
      void this.publishFromEvent("ready", {
        status: MEDIA_STATUSES.ready,
        autoplayBlocked: false,
        lastError: "",
      });
    });

    this.widget.bind(events.PLAY, () => {
      this.pendingWidgetError = "";
      void this.publishFromEvent("play", {
        status: MEDIA_STATUSES.playing,
        autoplayBlocked: false,
        lastError: "",
      });
    });

    this.widget.bind(events.PAUSE, () => {
      void this.publishFromEvent("pause", {
        status: MEDIA_STATUSES.paused,
        autoplayBlocked: false,
        lastError: "",
      });
    });

    this.widget.bind(events.FINISH, () => {
      void this.publishFromEvent("finish", {
        status: MEDIA_STATUSES.ended,
        autoplayBlocked: false,
        lastError: "",
      });
    });

    if (events.ERROR) {
      this.widget.bind(events.ERROR, () => {
        const message = "SoundCloud reported a player error.";
        this.pendingWidgetError = message;
        this.rejectReady(new Error(message));
        void this.publishFromEvent("error", {
          status: MEDIA_STATUSES.error,
          autoplayBlocked: false,
          lastError: message,
        });
        this.onError(message);
      });
    }

    this.listenersBound = true;
  }

  createReadyPromise(loadToken) {
    this.clearPendingReady();

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (this.pendingReady?.token === loadToken) {
          this.pendingReady = null;
        }
        reject(new Error("The SoundCloud widget could not load that URL."));
      }, READY_TIMEOUT_MS);

      this.pendingReady = {
        token: loadToken,
        timeoutId,
        resolve,
        reject,
      };
    });
  }

  resolveReady() {
    if (!this.pendingReady || this.pendingReady.token !== this.loadToken) {
      return;
    }

    const { timeoutId, resolve } = this.pendingReady;
    window.clearTimeout(timeoutId);
    this.pendingReady = null;
    resolve(true);
  }

  rejectReady(error) {
    if (!this.pendingReady || this.pendingReady.token !== this.loadToken) {
      return;
    }

    const { timeoutId, reject } = this.pendingReady;
    window.clearTimeout(timeoutId);
    this.pendingReady = null;
    reject(error);
  }

  clearPendingReady() {
    if (!this.pendingReady) {
      return;
    }

    window.clearTimeout(this.pendingReady.timeoutId);
    this.pendingReady = null;
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

      await wait(160);
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