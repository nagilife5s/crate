// YouTube を鳴らす係。プレーヤー（iframe）は1つだけ作り、曲が変わっても loadVideoById で使い回す。
// iframe は DOM 上で動かさない（動かすと読み込み直しになって止まる）。位置と大きさは app.js が CSS で合わせる。

let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube を読み込めませんでした（通信を確認してください）')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export class YouTubeEngine {
  constructor(mountId, { onState, onError } = {}) {
    this.mountId = mountId;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.player = null;
    this.readyPromise = null;
    this.videoId = null;
  }

  ensure() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = loadApi().then(() => new Promise((resolve) => {
      this.player = new window.YT.Player(this.mountId, {
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            const f = this.player.getIframe && this.player.getIframe();
            if (f) f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            resolve();
          },
          onStateChange: (e) => this.onState(e.data),
          onError: (e) => this.onError(e.data),
        },
      });
    })).catch((e) => { this.readyPromise = null; throw e; });
    return this.readyPromise;
  }

  async load(videoId, startAt = 0, autoplay = true) {
    await this.ensure();
    this.videoId = videoId;
    const opts = { videoId, startSeconds: Math.floor(startAt || 0) };
    if (autoplay) this.player.loadVideoById(opts);
    else this.player.cueVideoById(opts);
  }

  play() { this.player && this.player.playVideo(); }
  pause() {
    if (!this.player || !this.player.getPlayerState) return;
    const s = this.player.getPlayerState();
    if (s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING) this.player.pauseVideo();
  }
  seek(t) { this.player && this.player.seekTo(t, true); }
  get time() { return this.player && this.player.getCurrentTime ? this.player.getCurrentTime() || 0 : 0; }
  get duration() { const d = this.player && this.player.getDuration ? this.player.getDuration() : 0; return d > 0 ? d : null; }
  get state() { return this.player && this.player.getPlayerState ? this.player.getPlayerState() : YT_STATE.UNSTARTED; }
}
