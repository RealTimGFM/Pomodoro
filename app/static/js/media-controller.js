const SUPPORTED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".webm", ".aac", ".flac", ".opus"];

let youtubeApiPromise;

function createEmptySnapshot(volume = 65) {
  return {
    selection: null,
    title: "",
    sourceTitle: "",
    channelTitle: "",
    currentTime: 0,
    playlistIndex: 0,
    currentVideoId: "",
    volume,
    status: "idle",
    shouldResumeOnFocus: false,
  };
}

function isYouTubePlaylistSelection(selection) {
  return selection?.mediaType === "youtube_playlist";
}

export function getYouTubePlayerErrorMessage(errorCode) {
  switch (errorCode) {
    case 2:
      return "That YouTube link looks invalid or the video ID could not be understood.";
    case 5:
      return "The YouTube player could not load this video.";
    case 100:
      return "That YouTube video was not found, was removed, or is private.";
    case 101:
    case 150:
      return "The owner does not allow this YouTube item to be embedded.";
    case 153:
      return "The YouTube player request could not be verified.";
    default:
      return "The selected YouTube item could not be loaded.";
  }
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[data-youtube-iframe-api="true"]');
      const timeoutId = window.setTimeout(() => {
        reject(new Error("The YouTube player took too long to load."));
      }, 12000);

      const previousReadyHandler = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timeoutId);
        if (typeof previousReadyHandler === "function") {
          previousReadyHandler();
        }
        resolve(window.YT);
      };

      if (!existingScript) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.dataset.youtubeIframeApi = "true";
        script.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("The YouTube player could not be loaded."));
        };
        document.head.append(script);
      }
    });
  }

  return youtubeApiPromise;
}

function mapPlayerState(playerState) {
  switch (playerState) {
    case window.YT?.PlayerState?.PLAYING:
      return "playing";
    case window.YT?.PlayerState?.PAUSED:
      return "paused";
    case window.YT?.PlayerState?.BUFFERING:
      return "buffering";
    case window.YT?.PlayerState?.CUED:
      return "cued";
    default:
      return "idle";
  }
}

export function isPlausibleAudioUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    const path = url.pathname.toLowerCase();
    return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

export function getMediaControllerKind(selection) {
  if (!selection) {
    return null;
  }

  if (selection.mediaType === "local_file" || selection.mediaType === "audio_url") {
    return "audio";
  }

  if (selection.mediaType === "youtube_video" || selection.mediaType === "youtube_playlist") {
    return "youtube";
  }

  return null;
}

export function isYouTubeMediaSelection(selection) {
  return getMediaControllerKind(selection) === "youtube";
}

export class AudioController {
  constructor({ audioElementId, onSnapshot, onError }) {
    this.audioElement = document.getElementById(audioElementId);
    this.onSnapshot = typeof onSnapshot === "function" ? onSnapshot : () => { };
    this.onError = typeof onError === "function" ? onError : () => { };
    this.selection = null;
    this.volume = 65;
    this._objectUrl = null;
    this._syncIntervalId = null;
    this._setupListeners();
  }

  _setupListeners() {
    const emit = () => {
      if (this.selection) {
        this.onSnapshot(this.captureSnapshot());
      }
    };

    this.audioElement.addEventListener("play", emit);
    this.audioElement.addEventListener("pause", emit);
    this.audioElement.addEventListener("ended", emit);
    this.audioElement.addEventListener("loadedmetadata", emit);
    this.audioElement.addEventListener("error", () => {
      if (this.selection) {
        this.onError("The audio file could not be loaded or played.");
        this.onSnapshot(this.captureSnapshot());
      }
    });
  }

  _getStatus() {
    const el = this.audioElement;
    if (!this.selection) return "idle";
    if (!el.src || el.src === window.location.href) return "idle";
    if (el.error) return "idle";
    if (el.ended) return "idle";
    if (el.paused) return "paused";
    return "playing";
  }

  _startSyncLoop() {
    this._stopSyncLoop();
    this._syncIntervalId = window.setInterval(() => {
      if (this.selection && !this.audioElement.paused) {
        this.onSnapshot(this.captureSnapshot());
      }
    }, 2000);
  }

  _stopSyncLoop() {
    if (this._syncIntervalId !== null) {
      window.clearInterval(this._syncIntervalId);
      this._syncIntervalId = null;
    }
  }

  _revokeObjectUrl() {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  async load(selection, { autoplay = false, resumeState = null, volume = 65 } = {}) {
    if (!selection) {
      this.clear();
      return null;
    }

    this._stopSyncLoop();
    this._revokeObjectUrl();

    const el = this.audioElement;
    el.pause();

    this.selection = selection;
    this.volume = volume;
    el.volume = volume / 100;
    el.loop = true;

    if (selection.mediaType === "local_file") {
      if (!selection.file) {
        throw new Error("Local file is no longer available. Please select it again.");
      }
      this._objectUrl = URL.createObjectURL(selection.file);
      el.src = this._objectUrl;
    } else if (selection.mediaType === "audio_url") {
      if (!isPlausibleAudioUrl(selection.sourceUrl)) {
        throw new Error(
          "That does not look like a direct audio file URL. Paste a link ending in .mp3, .wav, .ogg, .m4a, or similar.",
        );
      }
      el.src = selection.sourceUrl;
    } else {
      throw new Error("Unsupported audio source type.");
    }

    el.load();

    const startTime = Number.isFinite(resumeState?.currentTime) ? resumeState.currentTime : 0;
    if (startTime > 0) {
      await new Promise((resolve) => {
        const onCanPlay = () => {
          el.removeEventListener("canplay", onCanPlay);
          resolve();
        };
        el.addEventListener("canplay", onCanPlay);
        window.setTimeout(resolve, 1500);
      });
      el.currentTime = startTime;
    }

    if (autoplay) {
      try {
        await el.play();
      } catch {
        // Autoplay blocked by browser policy - audio is loaded but not playing.
      }
    }

    this._startSyncLoop();
    return this.captureSnapshot();
  }

  async resume(resumeState = null) {
    if (!this.selection) {
      return null;
    }

    const el = this.audioElement;
    const hasSrc = el.src && el.src !== "" && el.src !== window.location.href;

    if (!hasSrc) {
      return this.load(this.selection, {
        autoplay: true,
        resumeState,
        volume: this.volume,
      });
    }

    const startTime = Number.isFinite(resumeState?.currentTime) ? resumeState.currentTime : null;
    if (startTime !== null && Number.isFinite(el.currentTime) && Math.abs(el.currentTime - startTime) > 3) {
      el.currentTime = startTime;
    }

    try {
      await el.play();
    } catch {
      // Autoplay blocked - degrade gracefully.
    }

    this._startSyncLoop();
    return this.captureSnapshot();
  }

  pause() {
    const el = this.audioElement;
    if (!el.src || el.src === window.location.href) {
      return null;
    }
    el.pause();
    return this.captureSnapshot();
  }

  applyVolume(volume) {
    this.volume = volume;
    this.audioElement.volume = volume / 100;
    return this.captureSnapshot();
  }

  captureSnapshot() {
    const el = this.audioElement;
    const currentTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;

    return {
      ...createEmptySnapshot(this.volume),
      selection: this.selection,
      title: this.selection?.title || "",
      sourceTitle: this.selection?.title || "",
      currentTime,
      status: this._getStatus(),
    };
  }

  clear({ silent = false } = {}) {
    this._stopSyncLoop();
    const el = this.audioElement;
    el.pause();
    el.removeAttribute("src");
    el.load();
    this._revokeObjectUrl();
    this.selection = null;

    const snapshot = createEmptySnapshot(this.volume);
    if (!silent) {
      this.onSnapshot(snapshot);
    }
    return snapshot;
  }
}

export class YouTubeController {
  constructor({ elementId, placeholderElement, onSnapshot, onError }) {
    this.elementId = elementId;
    this.placeholderElement = placeholderElement;
    this.onSnapshot = typeof onSnapshot === "function" ? onSnapshot : () => { };
    this.onError = typeof onError === "function" ? onError : () => { };
    this.player = null;
    this.selection = null;
    this.volume = 65;
    this.syncIntervalId = null;
    this.pendingReadyResolver = null;
    this.pendingReadyRejecter = null;
  }

  async load(selection, { autoplay = false, resumeState = null, volume = 65 } = {}) {
    if (!selection) {
      this.clear();
      return null;
    }

    await loadYouTubeIframeApi();
    this.selection = selection;
    this.volume = volume;

    this.stopSyncLoop();
    this.setPlaceholderVisible(true);
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    const playerConfig = this.buildPlayerConfig(selection, { autoplay, resumeState });
    const readyPromise = new Promise((resolve, reject) => {
      this.pendingReadyResolver = resolve;
      this.pendingReadyRejecter = reject;
    });

    this.player = new window.YT.Player(this.elementId, playerConfig);

    await readyPromise;
    this.setPlaceholderVisible(false);
    this.startSyncLoop();
    return this.captureSnapshot();
  }

  async resume(resumeState = null) {
    if (!this.selection) {
      return null;
    }

    if (!this.player) {
      return this.load(this.selection, {
        autoplay: true,
        resumeState,
        volume: this.volume,
      });
    }

    const startTime = Number.isFinite(resumeState?.currentTime) ? resumeState.currentTime : 0;
    const playlistIndex = Number.isFinite(resumeState?.playlistIndex) ? resumeState.playlistIndex : 0;

    try {
      if (isYouTubePlaylistSelection(this.selection)) {
        const currentIndex = this.safeCall(() => this.player.getPlaylistIndex(), 0);
        if (playlistIndex !== currentIndex) {
          this.player.playVideoAt(playlistIndex);
        }
      }

      if (startTime > 0) {
        this.player.seekTo(startTime, true);
      }

      this.player.playVideo();
      return this.captureSnapshot();
    } catch (error) {
      this.onError("The selected YouTube media could not be resumed.");
      return null;
    }
  }

  pause() {
    if (!this.player) {
      return null;
    }

    try {
      this.player.pauseVideo();
      return this.captureSnapshot();
    } catch (error) {
      return null;
    }
  }

  applyVolume(volume) {
    this.volume = volume;
    if (this.player) {
      this.safeCall(() => this.player.setVolume(volume));
    }
    return this.captureSnapshot();
  }

  captureSnapshot() {
    if (!this.selection) {
      return createEmptySnapshot(this.volume);
    }

    const videoData = this.safeCall(() => this.player.getVideoData(), {}) || {};
    const currentTime = this.safeCall(() => this.player.getCurrentTime(), 0);
    const playlistIndex = isYouTubePlaylistSelection(this.selection) ? this.safeCall(() => this.player.getPlaylistIndex(), 0) : 0;

    return {
      ...createEmptySnapshot(this.volume),
      selection: this.selection,
      title: videoData.title || this.selection.title || "",
      sourceTitle: this.selection.title || "",
      channelTitle: videoData.author || this.selection.channelTitle || "",
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      playlistIndex: Number.isFinite(playlistIndex) ? playlistIndex : 0,
      currentVideoId: videoData.video_id || this.selection.sourceId || "",
      status: this.player ? mapPlayerState(this.player.getPlayerState()) : "idle",
    };
  }

  clear({ silent = false } = {}) {
    this.stopSyncLoop();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    this.selection = null;
    this.pendingReadyResolver = null;
    this.pendingReadyRejecter = null;
    this.setPlaceholderVisible(true);

    const snapshot = createEmptySnapshot(this.volume);
    if (!silent) {
      this.onSnapshot(snapshot);
    }
    return snapshot;
  }

  buildPlayerConfig(selection, { autoplay, resumeState }) {
    const startTime = Math.max(0, Math.floor(resumeState?.currentTime || 0));
    const playlistIndex = Math.max(0, Math.floor(resumeState?.playlistIndex || 0));
    const isVideo = selection.mediaType === "youtube_video";
    const queueVideoIds = Array.isArray(selection.queueVideoIds) ? selection.queueVideoIds.filter(Boolean) : [];

    const playerVars = {
      autoplay: 0,
      controls: 1,
      disablekb: 0,
      enablejsapi: 1,
      fs: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      origin: window.location.origin,
      playsinline: 1,
      rel: 0,
    };

    if (isVideo) {
      if (startTime > 0) {
        playerVars.start = startTime;
      }
      playerVars.loop = 1;
      playerVars.playlist = selection.sourceId;
    }

    const config = {
      height: "100%",
      width: "100%",
      host: "https://www.youtube.com",
      playerVars,
      events: {
        onReady: (event) => {
          event.target.setVolume(this.volume);

          if (isVideo) {
            if (startTime > 0) {
              event.target.seekTo(startTime, true);
            }
            if (autoplay) {
              try {
                event.target.playVideo();
              } catch (error) {
                // handled by onAutoplayBlocked if browser blocks it
              }
            }
          } else if (queueVideoIds.length) {
            try {
              event.target.loadPlaylist(queueVideoIds, playlistIndex, startTime);
            } catch (error) {
              this.onError("The selected YouTube playlist could not be loaded.");
            }
          } else {
            try {
              event.target.loadPlaylist({
                list: selection.sourceId,
                listType: "playlist",
                index: playlistIndex,
                startSeconds: startTime,
              });
            } catch (error) {
              this.onError("The selected YouTube playlist could not be loaded.");
            }
          }

          if (typeof this.pendingReadyResolver === "function") {
            const resolve = this.pendingReadyResolver;
            this.pendingReadyResolver = null;
            this.pendingReadyRejecter = null;
            resolve();
          }

          this.onSnapshot(this.captureSnapshot());
        },

        onError: (event) => {
          this.handlePlayerError(event?.data);
        },

        onStateChange: () => {
          this.onSnapshot(this.captureSnapshot());
        },

        onAutoplayBlocked: () => {
          console.warn(
            `[YouTubePlayerAutoplayBlocked] mediaType=${this.selection?.mediaType || "unknown"} sourceId=${this.selection?.sourceId || "unknown"} origin=${window.location.origin}`
          );
          this.onError("Browser blocked autoplay. Click once inside the YouTube player, then the timer can control it.");
          this.onSnapshot(this.captureSnapshot());
        },
      },
    };

    if (isVideo) {
      config.videoId = selection.sourceId;
    }

    return config;
  }
  startSyncLoop() {
    this.stopSyncLoop();
    this.syncIntervalId = window.setInterval(() => {
      if (this.player && this.selection) {
        this.onSnapshot(this.captureSnapshot());
      }
    }, 1500);
  }

  stopSyncLoop() {
    if (this.syncIntervalId) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  setPlaceholderVisible(visible) {
    if (!this.placeholderElement) {
      return;
    }
    this.placeholderElement.classList.toggle("hidden", !visible);
  }

  handlePlayerError(errorCode) {
    const message = getYouTubePlayerErrorMessage(errorCode);
    console.error(
      `[YouTubePlayerError] code=${errorCode ?? "unknown"} mediaType=${this.selection?.mediaType || "unknown"} sourceId=${this.selection?.sourceId || "unknown"} origin=${window.location.origin}`,
    );

    if (typeof this.pendingReadyRejecter === "function") {
      const reject = this.pendingReadyRejecter;
      this.pendingReadyResolver = null;
      this.pendingReadyRejecter = null;
      reject(new Error(message));
      return;
    }

    this.onError(message);
  }

  safeCall(callback, fallback = null) {
    try {
      return callback();
    } catch (error) {
      return fallback;
    }
  }
}

export class MediaControllerRouter {
  constructor({ audioElementId, youtubeElementId, youtubePlaceholderElement, onSnapshot, onError }) {
    this.onSnapshot = typeof onSnapshot === "function" ? onSnapshot : () => { };
    this.onError = typeof onError === "function" ? onError : () => { };
    this.activeKind = null;
    this.volume = 65;

    this.audioController = new AudioController({
      audioElementId,
      onSnapshot: (snapshot) => {
        this._forwardSnapshot("audio", snapshot);
      },
      onError: this.onError,
    });

    this.youtubeController = new YouTubeController({
      elementId: youtubeElementId,
      placeholderElement: youtubePlaceholderElement,
      onSnapshot: (snapshot) => {
        this._forwardSnapshot("youtube", snapshot);
      },
      onError: this.onError,
    });
  }

  _forwardSnapshot(kind, snapshot) {
    if (kind !== this.activeKind) {
      return;
    }

    if (Number.isFinite(snapshot?.volume)) {
      this.volume = snapshot.volume;
    }

    this.onSnapshot(snapshot);
  }

  _controllerForKind(kind) {
    if (kind === "audio") {
      return this.audioController;
    }
    if (kind === "youtube") {
      return this.youtubeController;
    }
    return null;
  }

  async load(selection, options = {}) {
    if (!selection) {
      this.clear();
      return null;
    }

    const nextKind = getMediaControllerKind(selection);
    const nextController = this._controllerForKind(nextKind);
    if (!nextController) {
      throw new Error("Unsupported media source type.");
    }

    const previousController = this.activeKind && this.activeKind !== nextKind ? this._controllerForKind(this.activeKind) : null;
    if (previousController) {
      previousController.pause();
    }

    const snapshot = await nextController.load(selection, options);
    this.activeKind = nextKind;
    if (Number.isFinite(snapshot?.volume)) {
      this.volume = snapshot.volume;
    }

    if (previousController) {
      previousController.clear({ silent: true });
    }

    return snapshot;
  }

  async resume(resumeState = null) {
    const selection = resumeState?.selection || this.captureSnapshot().selection;
    const kind = getMediaControllerKind(selection);
    const controller = this._controllerForKind(kind);

    if (!controller) {
      return null;
    }

    if (this.activeKind !== kind) {
      const previousController = this.activeKind ? this._controllerForKind(this.activeKind) : null;
      if (previousController) {
        previousController.pause();
      }

      const snapshot = await controller.load(selection, {
        autoplay: true,
        resumeState,
        volume: Number.isFinite(resumeState?.volume) ? resumeState.volume : this.volume,
      });

      this.activeKind = kind;
      if (Number.isFinite(snapshot?.volume)) {
        this.volume = snapshot.volume;
      }

      if (previousController) {
        previousController.clear({ silent: true });
      }

      return snapshot;
    }

    const snapshot = await controller.resume(resumeState);
    if (Number.isFinite(snapshot?.volume)) {
      this.volume = snapshot.volume;
    }
    return snapshot;
  }

  pause() {
    const controller = this._controllerForKind(this.activeKind);
    return controller ? controller.pause() : null;
  }

  applyVolume(volume) {
    this.volume = volume;
    const controller = this._controllerForKind(this.activeKind);
    return controller ? controller.applyVolume(volume) : createEmptySnapshot(this.volume);
  }

  captureSnapshot() {
    const controller = this._controllerForKind(this.activeKind);
    return controller ? controller.captureSnapshot() : createEmptySnapshot(this.volume);
  }

  clear() {
    this.audioController.clear({ silent: true });
    this.youtubeController.clear({ silent: true });
    this.activeKind = null;

    const snapshot = createEmptySnapshot(this.volume);
    this.onSnapshot(snapshot);
    return snapshot;
  }
}
