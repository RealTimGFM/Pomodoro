let youtubeApiPromise;

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

export class YouTubeMediaController {
  constructor({ elementId, placeholderElement, onSnapshot, onError }) {
    this.elementId = elementId;
    this.placeholderElement = placeholderElement;
    this.onSnapshot = typeof onSnapshot === "function" ? onSnapshot : () => {};
    this.onError = typeof onError === "function" ? onError : () => {};
    this.player = null;
    this.selection = null;
    this.volume = 65;
    this.syncIntervalId = null;
    this.pendingReadyResolver = null;
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
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    const playerConfig = this.buildPlayerConfig(selection, { autoplay, resumeState });

    const readyPromise = new Promise((resolve) => {
      this.pendingReadyResolver = resolve;
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
      if (this.selection.mediaType === "playlist") {
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
      this.onError("The selected media could not be resumed.");
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
      return {
        selection: null,
        title: "",
        sourceTitle: "",
        channelTitle: "",
        currentTime: 0,
        playlistIndex: 0,
        currentVideoId: "",
        volume: this.volume,
        status: "idle",
      };
    }

    const videoData = this.safeCall(() => this.player.getVideoData(), {}) || {};
    const currentTime = this.safeCall(() => this.player.getCurrentTime(), 0);
    const playlistIndex = this.selection.mediaType === "playlist" ? this.safeCall(() => this.player.getPlaylistIndex(), 0) : 0;

    return {
      selection: this.selection,
      title: videoData.title || this.selection.title || "",
      sourceTitle: this.selection.title || "",
      channelTitle: videoData.author || this.selection.channelTitle || "",
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      playlistIndex: Number.isFinite(playlistIndex) ? playlistIndex : 0,
      currentVideoId: videoData.video_id || this.selection.sourceId,
      volume: this.volume,
      status: this.player ? mapPlayerState(this.player.getPlayerState()) : "idle",
    };
  }

  clear() {
    this.stopSyncLoop();
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    this.selection = null;
    this.setPlaceholderVisible(true);
    this.onSnapshot({
      selection: null,
      title: "",
      sourceTitle: "",
      channelTitle: "",
      currentTime: 0,
      playlistIndex: 0,
      currentVideoId: "",
      volume: this.volume,
      status: "idle",
    });
  }

  buildPlayerConfig(selection, { autoplay, resumeState }) {
    const startTime = Math.max(0, Math.floor(resumeState?.currentTime || 0));
    const playlistIndex = Math.max(0, Math.floor(resumeState?.playlistIndex || 0));
    const isVideo = selection.mediaType === "video";

    const playerVars = {
      autoplay: autoplay ? 1 : 0,
      controls: 1,
      disablekb: 0,
      enablejsapi: 1,
      fs: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      origin: window.location.origin,
      playsinline: 1,
      rel: 0,
      start: startTime,
    };

    if (isVideo) {
      playerVars.loop = 1;
      playerVars.playlist = selection.sourceId;
    } else {
      playerVars.list = selection.sourceId;
      playerVars.listType = "playlist";
      playerVars.index = playlistIndex;
    }

    const config = {
      height: "100%",
      width: "100%",
      host: "https://www.youtube.com",
      playerVars,
      events: {
        onReady: (event) => {
          event.target.setVolume(this.volume);
          if (!autoplay && startTime > 0 && selection.mediaType === "video") {
            event.target.seekTo(startTime, true);
          }
          if (typeof this.pendingReadyResolver === "function") {
            this.pendingReadyResolver();
            this.pendingReadyResolver = null;
          }
          this.onSnapshot(this.captureSnapshot());
        },
        onError: () => {
          this.onError("The selected YouTube item could not be loaded.");
        },
        onStateChange: () => {
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

  safeCall(callback, fallback = null) {
    try {
      return callback();
    } catch (error) {
      return fallback;
    }
  }
}
