import { DEFAULT_SETTINGS } from "./config.js";
import {
  getNotificationPermissionState,
  requestBrowserNotificationPermission,
} from "./notifications.js";
import { loadSettings, loadTheme, sanitizeSettings, saveSettings, saveTheme } from "./storage.js";
import { applyTheme, resolveTheme } from "./theme.js";
import { ToastManager } from "./toast-ui.js";

const elements = {
  form: document.getElementById("settings-form"),
  themeChoice: document.getElementById("theme-choice"),
  focusDuration: document.getElementById("focus-duration"),
  shortBreakDuration: document.getElementById("short-break-duration"),
  longBreakDuration: document.getElementById("long-break-duration"),
  defaultVolume: document.getElementById("default-volume"),
  defaultVolumeValue: document.getElementById("default-volume-value"),
  soundNotifications: document.getElementById("sound-notifications"),
  browserNotifications: document.getElementById("browser-notifications"),
  permissionState: document.getElementById("permission-state"),
  requestPermissionButton: document.getElementById("request-permission-button"),
  resetSettingsButton: document.getElementById("reset-settings-button"),
  feedback: document.getElementById("settings-feedback"),
  toastRegion: document.getElementById("toast-region"),
};

const toast = new ToastManager(elements.toastRegion);

function populateForm(settings) {
  elements.themeChoice.value = resolveTheme(loadTheme(window.localStorage));
  elements.focusDuration.value = `${settings.focusDurationMinutes}`;
  elements.shortBreakDuration.value = `${settings.shortBreakDurationMinutes}`;
  elements.longBreakDuration.value = `${settings.longBreakDurationMinutes}`;
  elements.defaultVolume.value = `${settings.defaultVolume}`;
  elements.defaultVolumeValue.textContent = `${settings.defaultVolume}%`;
  elements.soundNotifications.checked = settings.soundNotifications;
  elements.browserNotifications.checked = settings.browserNotifications;
}

function readFormValues() {
  return sanitizeSettings({
    focusDurationMinutes: elements.focusDuration.value,
    shortBreakDurationMinutes: elements.shortBreakDuration.value,
    longBreakDurationMinutes: elements.longBreakDuration.value,
    defaultVolume: elements.defaultVolume.value,
    soundNotifications: elements.soundNotifications.checked,
    browserNotifications: elements.browserNotifications.checked,
  });
}

function setFeedback(message) {
  elements.feedback.textContent = message;
}

function refreshPermissionUI() {
  const permission = getNotificationPermissionState();

  if (permission === "unsupported") {
    elements.permissionState.textContent = "Unsupported";
    elements.browserNotifications.checked = false;
    elements.browserNotifications.disabled = true;
    elements.requestPermissionButton.disabled = true;
    return permission;
  }

  elements.permissionState.textContent = permission === "default" ? "Not requested" : permission;
  elements.browserNotifications.disabled = permission === "denied";
  elements.requestPermissionButton.disabled = permission === "granted" || permission === "denied";

  if (permission === "denied") {
    elements.browserNotifications.checked = false;
  }

  return permission;
}

async function saveCurrentSettings() {
  const nextSettings = readFormValues();
  const nextTheme = resolveTheme(elements.themeChoice.value);
  const permission = refreshPermissionUI();

  if (nextSettings.browserNotifications && permission === "default") {
    const result = await requestBrowserNotificationPermission();
    if (result !== "granted") {
      nextSettings.browserNotifications = false;
      setFeedback("Browser notifications were not enabled because permission was not granted.");
      toast.show("Notification permission was not granted.", { tone: "warning" });
    }
  }

  if (permission === "denied" || refreshPermissionUI() === "denied") {
    nextSettings.browserNotifications = false;
  }

  saveSettings(window.localStorage, nextSettings);
  saveTheme(window.localStorage, nextTheme);
  applyTheme(nextTheme);
  populateForm(nextSettings);
  refreshPermissionUI();
  setFeedback("Settings saved locally.");
  toast.show("Settings saved.", { tone: "success" });
}

function resetSettings() {
  saveSettings(window.localStorage, DEFAULT_SETTINGS);
  saveTheme(window.localStorage, "dark");
  applyTheme("dark");
  populateForm(DEFAULT_SETTINGS);
  refreshPermissionUI();
  setFeedback("Settings reset to default values.");
  toast.show("Settings reset.", { tone: "info" });
}

function bindEvents() {
  elements.themeChoice.addEventListener("change", () => {
    applyTheme(resolveTheme(elements.themeChoice.value));
  });

  document.addEventListener("pomodoro-flow:theme-change", (event) => {
    elements.themeChoice.value = resolveTheme(event.detail?.theme);
  });

  elements.defaultVolume.addEventListener("input", () => {
    elements.defaultVolumeValue.textContent = `${elements.defaultVolume.value}%`;
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCurrentSettings();
  });

  elements.requestPermissionButton.addEventListener("click", async () => {
    const result = await requestBrowserNotificationPermission();
    refreshPermissionUI();
    const message =
      result === "granted"
        ? "Browser notifications are ready."
        : "Browser notification permission was not granted.";
    setFeedback(message);
    toast.show(message, { tone: result === "granted" ? "success" : "warning" });
  });

  elements.resetSettingsButton.addEventListener("click", () => {
    resetSettings();
  });
}

function initialize() {
  populateForm(loadSettings(window.localStorage));
  refreshPermissionUI();
  bindEvents();
}

document.addEventListener("DOMContentLoaded", initialize);
