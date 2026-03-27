import test from "node:test";
import assert from "node:assert/strict";

import {
  createSoundCloudEmbedUrl,
  createSoundCloudSnapshot,
  detectSoundCloudUrlKind,
  isLikelySoundCloudUrl,
  normalizeSoundCloudUrl,
} from "../../app/static/js/soundcloud-controller.js";

test("normalizeSoundCloudUrl keeps supported SoundCloud hosts and strips hash fragments", () => {
  assert.equal(
    normalizeSoundCloudUrl("http://soundcloud.com/artist/track-name#comments"),
    "https://soundcloud.com/artist/track-name",
  );
  assert.equal(normalizeSoundCloudUrl("https://example.com/not-soundcloud"), "");
});

test("detectSoundCloudUrlKind distinguishes tracks and playlists", () => {
  assert.equal(detectSoundCloudUrlKind("https://soundcloud.com/artist/sets/deep-work"), "playlist");
  assert.equal(detectSoundCloudUrlKind("https://soundcloud.com/artist/track-name"), "track");
  assert.equal(detectSoundCloudUrlKind("https://on.soundcloud.com/abc123"), "unknown");
});

test("createSoundCloudEmbedUrl encodes the source url for the official widget", () => {
  const embedUrl = createSoundCloudEmbedUrl("https://soundcloud.com/artist/track-name");

  assert.equal(isLikelySoundCloudUrl("https://soundcloud.com/artist/track-name"), true);
  assert.match(embedUrl, /^https:\/\/w\.soundcloud\.com\/player\/\?/);
  assert.match(embedUrl, /auto_play=false/);
  assert.match(embedUrl, /url=https%3A%2F%2Fsoundcloud\.com%2Fartist%2Ftrack-name/);
});

test("createSoundCloudSnapshot provides sensible defaults", () => {
  const snapshot = createSoundCloudSnapshot({ title: "Deep Focus" });

  assert.equal(snapshot.title, "Deep Focus");
  assert.equal(snapshot.status, "idle");
  assert.equal(snapshot.volume, 65);
  assert.equal(snapshot.canGoNext, false);
});
