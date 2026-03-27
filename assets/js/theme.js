import { loadTheme, saveTheme } from "./storage.js";

export const THEMES = Object.freeze({
  light: "light",
  dark: "dark",
  studyTime: "study-time",
});

const THEME_ORDER = [THEMES.dark, THEMES.light, THEMES.studyTime];

export function resolveTheme(storedTheme) {
  if (storedTheme === THEMES.light || storedTheme === THEMES.dark || storedTheme === THEMES.studyTime) {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? THEMES.dark : THEMES.light;
}

export function getNextTheme(theme) {
  const index = THEME_ORDER.indexOf(theme);
  if (index === -1) {
    return THEME_ORDER[0];
  }

  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

function getThemeToggleUi(theme) {
  const nextTheme = getNextTheme(theme);

  switch (nextTheme) {
    case THEMES.light:
      return {
        label: "Light",
        title: "Switch to light mode",
        icon: '<path d="M12 3.5v2.2M12 18.3v2.2M5.99 5.99l1.56 1.56M16.45 16.45l1.56 1.56M3.5 12h2.2M18.3 12h2.2M5.99 18.01l1.56-1.56M16.45 7.55l1.56-1.56M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8Z"></path>',
      };
    case THEMES.studyTime:
      return {
        label: "Study Time",
        title: "Switch to Study Time theme",
        icon: '<path d="M12 3 7 12h3v9l5-9h-3l4-9h-4Z"></path>',
      };
    case THEMES.dark:
    default:
      return {
        label: "Dark",
        title: "Switch to dark mode",
        icon: '<path d="M6.995 12a5.005 5.005 0 0 0 6.004 4.91A7 7 0 1 1 17 11a5 5 0 0 0-10.005 1Z"></path>',
      };
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent("pomodoro-flow:theme-change", { detail: { theme } }));
  const button = document.getElementById("theme-toggle");
  const label = button?.querySelector("[data-theme-label]");
  const icon = button?.querySelector("[data-theme-icon]");

  if (!button) {
    return;
  }

  const ui = getThemeToggleUi(theme);
  button.setAttribute("aria-label", ui.title);
  button.setAttribute("title", ui.title);

  if (label) {
    label.textContent = ui.label;
  }

  if (icon) {
    icon.innerHTML = ui.icon;
  }
}

function initializeTheme() {
  const storedTheme = loadTheme(window.localStorage);
  applyTheme(resolveTheme(storedTheme));

  const button = document.getElementById("theme-toggle");
  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    const currentTheme = resolveTheme(document.documentElement.dataset.theme);
    const nextTheme = getNextTheme(currentTheme);
    saveTheme(window.localStorage, nextTheme);
    applyTheme(nextTheme);
  });
}

document.addEventListener("DOMContentLoaded", initializeTheme);
