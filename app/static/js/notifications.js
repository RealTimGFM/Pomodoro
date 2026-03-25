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

export function playNotificationSound(enabled) {
  if (!enabled) {
    return;
  }

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
    oscillator.frequency.exponentialRampToValueAtTime(880, startTime + 0.18);

    gainNode.gain.setValueAtTime(0.001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.42);
    oscillator.onended = () => context.close().catch(() => {});
  } catch (error) {
    // Failing silently keeps the timer reliable even when audio is blocked.
  }
}
