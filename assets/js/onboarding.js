export class OnboardingTour {
  constructor({ steps = [], root, onFinish = () => {} } = {}) {
    this.steps = steps;
    this.root = root;
    this.onFinish = onFinish;
    this.index = 0;
    this.card = null;
  }

  start() {
    if (!this.root || !this.steps.length) {
      return;
    }

    this.root.hidden = false;
    this.root.classList.add("is-visible");
    this.render();
  }

  stop(completed = false) {
    this.root?.classList.remove("is-visible");
    if (this.root) {
      this.root.hidden = true;
      this.root.innerHTML = "";
    }
    this.card = null;
    this.onFinish(completed);
  }

  next() {
    if (this.index >= this.steps.length - 1) {
      this.stop(true);
      return;
    }

    this.index += 1;
    this.render();
  }

  render() {
    const step = this.steps[this.index];
    if (!step) {
      this.stop(true);
      return;
    }

    step.beforeFocus?.();

    const target = document.querySelector(step.target);
    if (!target) {
      this.next();
      return;
    }

    for (const element of document.querySelectorAll(".is-tour-target")) {
      element.classList.remove("is-tour-target");
    }
    target.classList.add("is-tour-target");

    this.root.innerHTML = `
      <div class="tour-scrim" data-tour-skip></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-label="Quick tour">
        <div class="tour-card__header">
          <span class="tour-card__step">Step ${this.index + 1} of ${this.steps.length}</span>
          <button class="tour-card__skip" type="button" data-tour-skip>Skip</button>
        </div>
        <h2 class="tour-card__title">${escapeHtml(step.title)}</h2>
        <p class="tour-card__body">${escapeHtml(step.body)}</p>
        <div class="tour-card__actions">
          <button class="button button--ghost" type="button" data-tour-skip>Skip</button>
          <button class="button button--primary" type="button" data-tour-next>
            ${this.index === this.steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    `;

    this.card = this.root.querySelector(".tour-card");
    this.root.querySelectorAll("[data-tour-skip]").forEach((element) => {
      element.addEventListener("click", () => this.stop(false));
    });
    this.root.querySelector("[data-tour-next]")?.addEventListener("click", () => this.next());

    positionCard(this.card, target);
    this.card.querySelector("[data-tour-next]")?.focus();
  }
}

function positionCard(card, target) {
  if (!card || !target) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const prefersBottom = rect.top < window.innerHeight / 2;
  const top = prefersBottom ? rect.bottom + 16 : rect.top - card.offsetHeight - 16;
  const left = Math.min(window.innerWidth - card.offsetWidth - 16, Math.max(16, rect.left));

  card.style.top = `${Math.max(16, top)}px`;
  card.style.left = `${left}px`;
}

function escapeHtml(value) {
  return `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
