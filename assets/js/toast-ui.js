const ICONS = {
  success:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.55 16.4-3.7-3.7 1.4-1.4 2.3 2.3 6.9-6.9 1.4 1.4-8.3 8.3Z"></path></svg>',
  info:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 10h2v7h-2zm0-3h2v2h-2zm1 15a10 10 0 1 1 0-20a10 10 0 0 1 0 20Z"></path></svg>',
  warning:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3l-8.47-14.14a2 2 0 0 0-3.42 0Z"></path></svg>',
  error:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.5 8.5-7 7m0-7 7 7M12 22A10 10 0 1 1 12 2a10 10 0 0 1 0 20Z"></path></svg>',
};

export class ToastManager {
  constructor(root) {
    this.root = root;
    this.counter = 0;
  }

  show(message, { tone = "info", duration = 3200 } = {}) {
    if (!this.root || !message) {
      return;
    }

    const toast = document.createElement("div");
    const id = `toast-${++this.counter}`;
    toast.className = `toast toast--${tone}`;
    toast.dataset.toastId = id;
    toast.innerHTML = `
      <span class="toast__icon">${ICONS[tone] || ICONS.info}</span>
      <span class="toast__message">${escapeHtml(message)}</span>
      <button class="toast__close" type="button" aria-label="Dismiss notification">
        <span aria-hidden="true">&times;</span>
      </button>
    `;

    toast.querySelector(".toast__close")?.addEventListener("click", () => {
      this.dismiss(toast);
    });

    this.root.append(toast);

    window.setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);

    if (duration > 0) {
      window.setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }
  }

  dismiss(toast) {
    if (!toast?.isConnected) {
      return;
    }

    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      toast.remove();
    }, 220);
  }
}

function escapeHtml(value) {
  return `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
