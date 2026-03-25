import { loadTheme, saveTheme } from "./storage.js";

function resolveTheme(storedTheme) {
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = document.getElementById("theme-toggle");
  if (button) {
    button.textContent = theme === "dark" ? "Light theme" : "Dark theme";
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
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    saveTheme(window.localStorage, nextTheme);
    applyTheme(nextTheme);
  });
}

document.addEventListener("DOMContentLoaded", initializeTheme);
