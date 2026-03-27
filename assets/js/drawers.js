export class DrawerController {
  constructor({ layout, column, backdrop, triggers = [], panels = [], state, onChange = () => {} } = {}) {
    this.layout = layout;
    this.column = column;
    this.backdrop = backdrop;
    this.triggers = triggers;
    this.panels = panels;
    this.state = structuredClone(state);
    this.onChange = onChange;
  }

  initialize() {
    for (const trigger of this.triggers) {
      trigger.addEventListener("click", () => {
        const drawer = trigger.dataset.drawerTrigger;
        this.toggleOpen(drawer);
      });
    }

    for (const panel of this.panels) {
      panel.querySelector("[data-drawer-close]")?.addEventListener("click", () => {
        this.setDrawerState(panel.dataset.drawerPanel, { open: false, pinned: false });
      });

      panel.querySelector("[data-drawer-pin]")?.addEventListener("click", () => {
        this.togglePinned(panel.dataset.drawerPanel);
      });
    }

    this.backdrop?.addEventListener("click", () => {
      for (const [name, drawerState] of Object.entries(this.state.drawers)) {
        if (drawerState.open && !drawerState.pinned) {
          this.setDrawerState(name, { open: false, pinned: false });
        }
      }
    });

    this.syncDom();
  }

  getState() {
    return structuredClone(this.state);
  }

  setState(nextState) {
    this.state = structuredClone(nextState);
    this.syncDom();
    this.onChange(this.getState());
  }

  setDrawerState(name, nextValues) {
    if (!this.state.drawers[name]) {
      return;
    }

    const nextDrawerState = {
      ...this.state.drawers[name],
      ...nextValues,
    };

    if (nextDrawerState.pinned) {
      nextDrawerState.open = true;
    }

    if (!nextDrawerState.open) {
      nextDrawerState.pinned = false;
    }

    if (nextDrawerState.open && !nextDrawerState.pinned) {
      for (const [drawerName, drawerState] of Object.entries(this.state.drawers)) {
        if (drawerName !== name && drawerState.open && !drawerState.pinned) {
          this.state.drawers[drawerName] = {
            ...drawerState,
            open: false,
            pinned: false,
          };
        }
      }
    }

    this.state.drawers[name] = nextDrawerState;
    this.syncDom();
    this.onChange(this.getState());
  }

  toggleOpen(name) {
    const current = this.state.drawers[name];
    if (!current) {
      return;
    }

    this.setDrawerState(name, {
      open: !current.open,
      pinned: current.pinned && !current.open,
    });
  }

  togglePinned(name) {
    const current = this.state.drawers[name];
    if (!current) {
      return;
    }

    this.setDrawerState(name, {
      open: true,
      pinned: !current.pinned,
    });
  }

  openForTour(name) {
    this.setDrawerState(name, {
      open: true,
      pinned: false,
    });
  }

  syncDom() {
    const hasPinnedDrawer = Object.values(this.state.drawers).some((drawer) => drawer.open && drawer.pinned);
    const hasOverlayDrawer = Object.values(this.state.drawers).some((drawer) => drawer.open && !drawer.pinned);

    this.layout?.setAttribute("data-has-pinned", hasPinnedDrawer ? "true" : "false");
    this.backdrop?.classList.toggle("is-visible", hasOverlayDrawer);
    if (this.column) {
      this.column.hidden = !hasPinnedDrawer && !hasOverlayDrawer;
    }

    for (const panel of this.panels) {
      const name = panel.dataset.drawerPanel;
      const drawerState = this.state.drawers[name];
      const isOpen = Boolean(drawerState?.open);
      const isPinned = Boolean(drawerState?.pinned);
      panel.hidden = !isOpen;
      panel.dataset.drawerVariant = isPinned ? "pinned" : "overlay";
      panel.classList.toggle("is-open", isOpen);
      panel.classList.toggle("is-pinned", isPinned);
      panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
      panel.querySelector("[data-drawer-pin]")?.setAttribute("aria-pressed", isPinned ? "true" : "false");
      panel.querySelector("[data-drawer-pin-label]")?.replaceChildren(document.createTextNode(isPinned ? "Pinned" : "Pin"));
    }

    for (const trigger of this.triggers) {
      const name = trigger.dataset.drawerTrigger;
      const drawerState = this.state.drawers[name];
      const isOpen = Boolean(drawerState?.open);
      const isPinned = Boolean(drawerState?.pinned);
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      trigger.classList.toggle("is-active", isOpen);
      const statusLabel = trigger.querySelector("[data-drawer-status]");
      if (statusLabel) {
        statusLabel.textContent = isPinned ? "Pinned" : isOpen ? "Open" : "Closed";
      }
    }
  }
}
