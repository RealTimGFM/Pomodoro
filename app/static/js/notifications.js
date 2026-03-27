export function getNotificationPermissionState() {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export function sendBrowserNotification(settings, title, body) {
  if (!settings.browserNotifications || !("Notification" in window) || Notification.permission !== "granted") {
    return null;
  }

  return new Notification(title, {
    body,
    silent: true,
  });
}

let activeCountdownTimers = [];

function clearCountdownTimers() {
  for (const timerId of activeCountdownTimers) {
    window.clearTimeout(timerId);
  }
  activeCountdownTimers = [];
}

function playSingleBeep() {
  const AudioContextRef = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextRef) {
    return;
  }

  try {
    const context = new AudioContextRef();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const startTime = context.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, startTime + 0.12);

    gainNode.gain.setValueAtTime(0.001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.07, startTime + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.16);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.18);
    oscillator.onended = () => context.close().catch(() => {});
  } catch (error) {
    // Failing silently keeps the timer reliable even when audio is blocked.
  }
}

export function stopNotificationSound() {
  clearCountdownTimers();
}

export function playNotificationSound(enabled, durationMs = 5000) {
  if (!enabled) {
    return;
  }

  clearCountdownTimers();

  const intervalMs = 1000;
  const totalBeeps = Math.max(1, Math.ceil(durationMs / intervalMs));

  for (let i = 0; i < totalBeeps; i += 1) {
    const timerId = window.setTimeout(() => {
      playSingleBeep();
    }, i * intervalMs);

    activeCountdownTimers.push(timerId);
  }
}