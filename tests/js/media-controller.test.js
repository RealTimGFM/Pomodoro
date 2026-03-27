import test from "node:test";
import assert from "node:assert/strict";

import { getMediaControllerKind, getYouTubePlayerErrorMessage, isPlausibleAudioUrl } from "../../app/static/js/media-controller.js";

test("isPlausibleAudioUrl accepts direct audio file links", () => {
  assert.equal(isPlausibleAudioUrl("https://cdn.example.com/focus/track.mp3"), true);
  assert.equal(isPlausibleAudioUrl("https://cdn.example.com/focus/track.wav?download=1"), true);
});

test("isPlausibleAudioUrl rejects non-audio pages", () => {
  assert.equal(isPlausibleAudioUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(isPlausibleAudioUrl("https://example.com/article"), false);
});

test("getMediaControllerKind routes audio and youtube selections to the right controller", () => {
  assert.equal(getMediaControllerKind({ mediaType: "audio_url" }), "audio");
  assert.equal(getMediaControllerKind({ mediaType: "local_file" }), "audio");
  assert.equal(getMediaControllerKind({ mediaType: "youtube_video" }), "youtube");
  assert.equal(getMediaControllerKind({ mediaType: "youtube_playlist" }), "youtube");
  assert.equal(getMediaControllerKind({ mediaType: "spotify_track" }), null);
});

test("getYouTubePlayerErrorMessage maps iframe errors to readable copy", () => {
  assert.equal(getYouTubePlayerErrorMessage(2), "That YouTube link looks invalid or the video ID could not be understood.");
  assert.equal(getYouTubePlayerErrorMessage(5), "The YouTube player could not load this video.");
  assert.equal(getYouTubePlayerErrorMessage(100), "That YouTube video was not found, was removed, or is private.");
  assert.equal(getYouTubePlayerErrorMessage(101), "The owner does not allow this YouTube item to be embedded.");
  assert.equal(getYouTubePlayerErrorMessage(150), "The owner does not allow this YouTube item to be embedded.");
  assert.equal(getYouTubePlayerErrorMessage(153), "The YouTube player request could not be verified.");
  assert.equal(getYouTubePlayerErrorMessage(999), "The selected YouTube item could not be loaded.");
});
