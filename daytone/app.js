import { deleteMemory, getMemories, putMemory } from "./src/memory-store.js";
import { findBestAudioMoment, frameSchedule, readId3 } from "./src/audio-moment.js";
import { suggestDayTitle, composeAtmosphere, samplePhotos, applyAtmosphere } from "./src/atmosphere.js";
import { makeDemoDays } from "./src/demo-days.js";
import { exportDay } from "./src/day-export.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const MAX_STORY_LENGTH = 10000;
const DB_IMAGE_FIELDS = ["id", "name", "type", "blob"];

const dom = {
  archiveScreen: $("#archive-screen"),
  createScreen: $("#create-screen"),
  createButton: $("#create-memory-button"),
  archiveContent: $("#archive-content"),
  archiveCount: $("#archive-count"),
  archiveSearch: $("#archive-search"),
  archiveDateFilter: $("#archive-date-filter"),
  archiveMessage: $("#archive-message"),
  form: $("#memory-form"),
  title: $("#memory-title"),
  story: $("#memory-text"),
  date: $("#memory-date"),
  mood: $("#memory-mood"),
  moodGroup: $("#memory-mood-group"),
  characterCount: $("#character-count"),
  stageTabs: $$("[data-stage]"),
  stagePanels: $$("[data-panel='story'], [data-panel='frames'], [data-panel='soundtrack']"),
  storyNext: $("#story-next"),
  framesBack: $("#frames-back"),
  framesNext: $("#frames-next"),
  soundtrackBack: $("#soundtrack-back"),
  cancelCreate: $("#cancel-create"),
  photoFiles: $("#photo-files"),
  photoDropzone: $("#photo-dropzone"),
  photoGrid: $("#photo-grid"),
  photoStatus: $("#photo-status"),
  audioFile: $("#audio-file"),
  localTrackTitle: $("#local-track-title"),
  fileName: $("#file-name"),
  localMessage: $("#local-message"),
  localPlayer: $("#local-audio-player"),
  audioVisualizer: $("#audio-visualizer"),
  youtubeUrl: $("#youtube-url"),
  youtubeStatus: $("#youtube-status"),
  youtubePreview: $("#youtube-preview"),
  localPanel: $("#local-panel"),
  youtubePanel: $("#youtube-panel"),
  excerptStart: $("#excerpt-start"),
  excerptDuration: $("#excerpt-duration"),
  excerptHelp: $("#excerpt-help"),
  formMessage: $("#form-message"),
  saveButton: $("#save-button"),
  memoryDialog: $("#memory-dialog"),
  presentationImage: $("#presentation-image"),
  presentationEmpty: $("#presentation-empty"),
  presentationEmptyTitle: $("#presentation-empty-title"),
  presentationIndicator: $("#presentation-indicator"),
  presentationTitle: $("#presentation-title"),
  presentationStory: $("#presentation-story"),
  presentationDate: $("#presentation-date"),
  presentationTrack: $("#presentation-track"),
  presentationOpenYoutube: $("#presentation-open-youtube"),
  presentationPlay: $("#presentation-play"),
  presentationPrev: $("#presentation-prev"),
  presentationNext: $("#presentation-next"),
  presentationProgress: $("#presentation-progress"),
  presentationTime: $("#presentation-time"),
  presentationStatus: $("#presentation-status"),
  presentationClose: $("#presentation-close"),
  presentationAudio: $("#presentation-audio"),
  presentationYoutube: $("#presentation-youtube"),
  photoLightbox: $("#photo-lightbox"),
  photoLightboxImage: $("#photo-lightbox-image"),
  photoLightboxClose: $("#photo-lightbox-close"),
};

const requiredElements = [
  "archiveScreen", "createScreen", "archiveContent", "form", "title", "story", "date",
  "mood", "photoGrid", "localPlayer", "youtubeUrl", "memoryDialog", "presentationAudio",
];
const missingElements = requiredElements.filter((key) => !dom[key]);
if (missingElements.length) {
  throw new Error(`DAYTONE is missing required page elements: ${missingElements.join(", ")}`);
}

const state = {
  records: [],
  activeMode: "local",
  activeStage: "story",
  editId: null,
  selectedAudio: null,
  audioFileName: "",
  audioDuration: 0,
  audioMoment: null,
  audioAnalysis: null,
  audioArtist: "",
  trackTitleEdited: false,
  audioLoadFailed: false,
  localObjectUrl: "",
  localPreviewTimer: 0,
  metadata: null,
  metadataRequest: 0,
  metadataTimer: 0,
  previewVideoId: "",
  photos: [],
  coverPhotoId: "",
  draggedPhotoId: "",
  titleWasEdited: false,
  archiveObjectUrls: [],
  photoPreviewUrl: "",
  audioContext: null,
  audioAnalyser: null,
  audioSource: null,
  visualizerFrame: null,
  presentationRecord: null,
  presentationPhotos: [],
  presentationSequence: [],
  presentationFrame: 0,
  presentationStart: 0,
  presentationDuration: 0,
  presentationSchedule: { times: [], detected: false },
  presentationEnded: false,
  presentationSession: 0,
  presentationAudioUrl: "",
  presentationKind: "",
  youtubePlayer: null,
  youtubePlayerReady: false,
  youtubePlayerPromise: null,
  youtubeApiPromise: null,
  presentationTimer: 0,
  saveInProgress: false,
  demoInProgress: false,
};

$("#footer-year").textContent = String(new Date().getFullYear());
$("#today-date").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());
dom.date.value = localDateString(new Date());
updateCharacterCount();
setStage("story");
setMode("local", { initial: true });
renderArchiveLoading();

dom.createButton.addEventListener("click", startNewMemory);
$$('[data-action="create"]').forEach((button) => button.addEventListener("click", startNewMemory));
$$('[data-action="archive"]').forEach((button) => button.addEventListener("click", showArchive));
$(".wordmark")?.addEventListener("click", (event) => {
  event.preventDefault();
  showArchive();
});

dom.story.addEventListener("input", () => {
  updateCharacterCount();
  clearFormMessage();
  if (!state.titleWasEdited || !dom.title.value.trim()) {
    dom.title.value = suggestTitle(dom.story.value);
    state.titleWasEdited = false;
  }
});

dom.title.addEventListener("input", () => {
  state.titleWasEdited = Boolean(dom.title.value.trim());
});

dom.moodGroup.addEventListener("click", (event) => {
  const button = event.target.closest("[data-mood]");
  if (!button) return;
  setMood(button.dataset.mood);
});

dom.date.addEventListener("change", clearFormMessage);
dom.storyNext.addEventListener("click", () => {
  if (validateStory()) setStage("frames");
});
dom.framesBack.addEventListener("click", () => setStage("story"));
dom.framesNext.addEventListener("click", () => {
  if (validatePhotos()) setStage("soundtrack");
});
dom.soundtrackBack.addEventListener("click", () => setStage("frames"));
dom.stageTabs.forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.stage;
  if (target === "frames" && !validateStory()) return;
  if (target === "soundtrack" && (!validateStory() || !validatePhotos())) return;
  setStage(target);
}));
dom.cancelCreate.addEventListener("click", cancelEditing);
dom.form.addEventListener("submit", saveMemory);
$("#load-demo-days").addEventListener("click", loadDemoDays);
$("#export-day").addEventListener("click", async () => {
  const record = state.presentationRecord;
  if (!record) return;
  const button = $("#export-day");
  button.disabled = true;
  setPresentationStatus("Preparing a portable day folder…");
  try {
    await exportDay(record);
    setPresentationStatus("Folder downloaded. Unzip it and open memory.html to revisit this day.");
  } catch (error) {
    setPresentationStatus(error.message || "Could not export this day. Your saved memory is unchanged.");
  } finally { button.disabled = false; }
});
$("#narrate-day").addEventListener("click", narrateDay);
$("#narrate-day").hidden = !("speechSynthesis" in window);

$$(".source-option").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
dom.audioFile.addEventListener("change", handleAudioSelection);
dom.localTrackTitle.addEventListener("input", () => { state.trackTitleEdited = true; });
dom.localPlayer.addEventListener("play", () => {
  const bounds = localExcerpt();
  if (bounds && (dom.localPlayer.currentTime < bounds.startTime
      || dom.localPlayer.currentTime >= bounds.startTime + bounds.excerptDuration - 0.04)) {
    dom.localPlayer.currentTime = bounds.startTime;
  }
  window.clearInterval(state.localPreviewTimer);
  state.localPreviewTimer = window.setInterval(updateLocalPreview, 40);
  startAudioVisualization();
});
function updateLocalPreview() {
  const bounds = localExcerpt();
  if (!bounds || dom.localPlayer.paused) return;
  if (dom.localPlayer.currentTime < bounds.startTime) dom.localPlayer.currentTime = bounds.startTime;
  if (dom.localPlayer.currentTime >= bounds.startTime + bounds.excerptDuration) dom.localPlayer.pause();
}
dom.localPlayer.addEventListener("timeupdate", updateLocalPreview);
dom.localPlayer.addEventListener("pause", () => {
  if (!dom.localPlayer.paused) return;
  window.clearInterval(state.localPreviewTimer);
  stopAudioVisualization();
});
dom.localPlayer.addEventListener("loadedmetadata", handleLocalMetadata);
dom.localPlayer.addEventListener("error", handleLocalAudioError);
dom.youtubeUrl.addEventListener("input", handleYoutubeInput);
dom.excerptStart.addEventListener("input", handleExcerptInput);
dom.excerptStart.addEventListener("change", refreshYoutubeExcerptPreview);
dom.excerptDuration.addEventListener("input", handleExcerptInput);
dom.excerptDuration.addEventListener("change", refreshYoutubeExcerptPreview);

dom.photoFiles.addEventListener("change", () => {
  addPhotos(dom.photoFiles.files);
  dom.photoFiles.value = "";
});
dom.photoDropzone.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  dom.photoFiles.click();
});
for (const eventName of ["dragenter", "dragover"]) {
  dom.photoDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.photoDropzone.classList.add("is-dragover");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dom.photoDropzone.addEventListener(eventName, (event) => {
    if (eventName === "drop") {
      event.preventDefault();
      addPhotos(event.dataTransfer?.files);
    }
    dom.photoDropzone.classList.remove("is-dragover");
  });
}
dom.photoGrid.addEventListener("click", handlePhotoAction);
dom.photoGrid.addEventListener("dragstart", handlePhotoDragStart);
dom.photoGrid.addEventListener("dragover", handlePhotoDragOver);
dom.photoGrid.addEventListener("dragleave", handlePhotoDragLeave);
dom.photoGrid.addEventListener("drop", handlePhotoDrop);
dom.photoGrid.addEventListener("dragend", clearDragState);

dom.archiveContent.addEventListener("click", handleArchiveAction);
dom.archiveSearch.addEventListener("input", renderArchive);
dom.archiveDateFilter.addEventListener("change", renderArchive);

dom.presentationPlay.addEventListener("click", togglePresentationPlayback);
dom.presentationPrev.addEventListener("click", () => stepPresentationFrame(-1));
dom.presentationNext.addEventListener("click", () => stepPresentationFrame(1));
dom.presentationProgress.addEventListener("input", () => {
  seekPresentation();
});
dom.presentationClose.addEventListener("click", closePresentation);
dom.presentationOpenYoutube?.addEventListener("click", () => {
  try {
    state.youtubePlayer?.pauseVideo();
  } catch {
    // The external link remains usable if the embedded player has already closed.
  }
});
dom.memoryDialog.addEventListener("close", () => {
  if (!dom.memoryDialog.open) stopPresentationPlayback();
});
dom.memoryDialog.addEventListener("cancel", stopPresentationPlayback);
dom.memoryDialog.addEventListener("click", (event) => {
  if (event.target === dom.memoryDialog) closePresentation();
});

if (dom.photoLightbox && dom.photoLightboxImage) {
  dom.photoLightbox.addEventListener("close", () => {
    dom.photoLightboxImage.removeAttribute("src");
    if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
    state.photoPreviewUrl = "";
  });
  dom.photoLightboxClose?.addEventListener("click", () => dom.photoLightbox.close());
  dom.photoLightbox.addEventListener("click", (event) => {
    if (event.target === dom.photoLightbox) dom.photoLightbox.close();
  });
}

dom.presentationAudio.addEventListener("timeupdate", updateLocalPresentation);
dom.presentationAudio.addEventListener("loadedmetadata", updateLocalPresentation);
dom.presentationAudio.addEventListener("play", () => {
  if (state.presentationKind !== "local") return;
  setPresentationPlaying(true);
  clearPresentationTimer();
  state.presentationTimer = window.setInterval(updateLocalPresentation, 40);
});
dom.presentationAudio.addEventListener("pause", () => {
  if (!dom.presentationAudio.paused || state.presentationKind !== "local") return;
  setPresentationPlaying(false);
  clearPresentationTimer();
});
dom.presentationAudio.addEventListener("ended", () => {
  if (state.presentationKind === "local" && dom.presentationAudio.ended) finishPresentationPlayback();
});

window.addEventListener("pagehide", (event) => {
  stopAudioVisualization();
  stopPresentationPlayback();
  if (!event.persisted) {
    releaseLocalObjectUrl();
    releasePhotoUrls(state.photos);
    releaseArchiveObjectUrls();
    releasePresentationPhotoUrls();
  }
});

loadArchive();

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setScreen(screen) {
  const showCreate = screen === "create";
  dom.archiveScreen.hidden = showCreate;
  dom.createScreen.hidden = !showCreate;
  document.body.classList.toggle("is-creating", showCreate);
  if (showCreate) window.scrollTo({ top: 0, behavior: "smooth" });
}

function showArchive() {
  if (state.saveInProgress) return;
  stopComposerPlayback();
  closePresentation();
  setScreen("archive");
  renderArchive();
}

function startNewMemory() {
  if (state.saveInProgress) return;
  if (hasUnsavedDraft() && !window.confirm("Start a new memory? Your unsaved changes will be lost.")) return;
  closePresentation();
  resetDraft();
  state.editId = null;
  state.titleWasEdited = false;
  dom.saveButton.querySelector("span").textContent = "Save this memory";
  setStage("story");
  setScreen("create");
  dom.story.focus({ preventScroll: true });
}

function hasUnsavedDraft() {
  return Boolean(
    state.editId
    || dom.title.value.trim()
    || dom.story.value.trim()
    || state.photos.length
    || state.selectedAudio
    || dom.youtubeUrl.value.trim(),
  );
}

function resetDraft() {
  stopComposerPlayback();
  clearFormMessage();
  releaseLocalObjectUrl();
  releasePhotoUrls(state.photos);
  state.photos = [];
  state.coverPhotoId = "";
  state.selectedAudio = null;
  state.audioFileName = "";
  state.audioDuration = 0;
  state.audioMoment = null;
  state.audioAnalysis = null;
  state.audioArtist = "";
  state.trackTitleEdited = false;
  state.audioLoadFailed = false;
  state.metadata = null;
  state.metadataRequest += 1;
  state.previewVideoId = "";
  dom.form.reset();
  dom.date.value = localDateString(new Date());
  dom.audioFile.value = "";
  dom.photoFiles.value = "";
  dom.fileName.textContent = "Choose an audio file";
  dom.localMessage.textContent = "No track selected yet.";
  dom.localMessage.classList.remove("is-error");
  dom.photoStatus.textContent = "No photographs added yet.";
  dom.excerptStart.value = "";
  dom.youtubeUrl.value = "";
  clearYoutubePreview();
  clearMetadataCard();
  setYoutubeStatus("Add a link to look up its details.");
  setMood("");
  updateCharacterCount();
  renderPhotoGrid();
  setMode("local");
}

function cancelEditing() {
  if (state.saveInProgress) return;
  const hasDraft = dom.story.value.trim() || dom.title.value.trim() || state.photos.length
    || state.selectedAudio || dom.youtubeUrl.value.trim();
  if (hasDraft && !window.confirm("Leave without saving? The changes in this draft will be lost.")) return;
  resetDraft();
  state.editId = null;
  setStage("story");
  showArchive();
}

function setStage(stage) {
  if (!["story", "frames", "soundtrack"].includes(stage)) return;
  state.activeStage = stage;
  dom.stagePanels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== stage;
  });
  dom.stageTabs.forEach((button) => {
    const isCurrent = button.dataset.stage === stage;
    const isComplete = ["story", "frames", "soundtrack"].indexOf(button.dataset.stage)
      < ["story", "frames", "soundtrack"].indexOf(stage);
    button.classList.toggle("is-current", isCurrent);
    button.classList.toggle("is-complete", isComplete);
    if (isCurrent) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  clearFormMessage();
  if (stage !== "soundtrack") stopComposerPlayback();
  else if (state.activeMode === "youtube" && dom.youtubeUrl.value.trim()) scheduleYoutubeLookup();
}

function validateStory() {
  const story = dom.story.value.trim();
  if (!story) {
    setStage("story");
    setFormMessage("Write a few words about the day before continuing.", true);
    dom.story.focus();
    return false;
  }
  if (!dom.date.value) {
    setStage("story");
    setFormMessage("Choose the date this memory belongs to.", true);
    dom.date.focus();
    return false;
  }
  clearFormMessage();
  return true;
}

function validatePhotos() {
  if (state.photos.some((photo) => photo.blob instanceof Blob && photo.blob.size > 0)) return true;
  setStage("frames");
  setFormMessage("Add at least one photograph to keep this memory.", true);
  dom.photoDropzone.focus();
  return false;
}

function setMood(mood) {
  dom.mood.value = mood || "";
  $$("[data-mood]", dom.moodGroup).forEach((button) => {
    const selected = button.dataset.mood === mood;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-selected", selected);
  });
}

function updateCharacterCount() {
  dom.characterCount.textContent = `${dom.story.value.length} / ${MAX_STORY_LENGTH}`;
}

function suggestTitle(text) {
  return suggestDayTitle(text);
}

function setFormMessage(message, isError = false) {
  dom.formMessage.textContent = message;
  dom.formMessage.classList.toggle("is-error", isError);
}

function clearFormMessage() {
  dom.formMessage.textContent = "";
  dom.formMessage.classList.remove("is-error");
}

function isSupportedAudio(file) {
  return /\.(mp3|wav)$/i.test(file.name);
}

function readableTitle(fileName) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || fileName;
}

function handleAudioSelection() {
  if (state.saveInProgress) return;
  clearFormMessage();
  const file = dom.audioFile.files?.[0];
  if (!file) return;
  if (!isSupportedAudio(file)) {
    dom.audioFile.value = "";
    dom.localMessage.textContent = "That file is not an MP3 or WAV. Your current track is unchanged.";
    dom.localMessage.classList.add("is-error");
    return;
  }
  stopComposerPlayback();
  state.selectedAudio = file;
  state.audioFileName = file.name;
  state.audioDuration = 0;
  state.audioLoadFailed = false;
  state.audioMoment = null;
  state.audioArtist = "";
  state.trackTitleEdited = false;
  dom.localTrackTitle.value = readableTitle(file.name);
  releaseLocalObjectUrl();
  state.localObjectUrl = URL.createObjectURL(file);
  dom.localPlayer.src = state.localObjectUrl;
  dom.fileName.textContent = file.name;
  dom.localMessage.textContent = "Finding a 15-second excerpt…";
  dom.localMessage.classList.remove("is-error");
  const decoded = file.size <= 50 * 1024 * 1024 ? findBestAudioMoment(file, 15).catch(() => null) : Promise.resolve(null);
  state.audioAnalysis = Promise.all([decoded, readId3(file).catch(() => ({}))]).then(([moment, tags]) => {
    if (state.selectedAudio !== file) return;
    state.audioMoment = moment || { startTime: 0, excerptDuration: 15, beatMap: [] };
    state.audioArtist = tags.artist || "";
    if (!state.trackTitleEdited && tags.title) dom.localTrackTitle.value = tags.title.slice(0, 200);
    showLocalExcerpt();
  });
}

function localExcerpt() {
  if (!state.audioMoment || !state.audioDuration) return null;
  const excerptDuration = Math.min(state.audioDuration, state.audioMoment.excerptDuration);
  const startTime = Math.min(state.audioMoment.startTime, state.audioDuration - excerptDuration);
  const beatMap = state.audioMoment.beatMap.map((time) => time + state.audioMoment.startTime - startTime)
    .filter((time) => time > 0 && time < excerptDuration);
  return { startTime, excerptDuration, beatMap };
}

function showLocalExcerpt() {
  const bounds = localExcerpt();
  if (!bounds || state.audioLoadFailed || dom.localPlayer.readyState < HTMLMediaElement.HAVE_METADATA) return;
  dom.localPlayer.hidden = false;
  dom.localMessage.textContent = `${formatTime(bounds.startTime)}–${formatTime(bounds.startTime + bounds.excerptDuration)} · ${bounds.beatMap.length >= 2 ? "Approximate musical events detected" : "Even pacing fallback"}`;
  if (dom.localPlayer.paused) dom.localPlayer.currentTime = bounds.startTime;
}

function releaseLocalObjectUrl() {
  if (state.localObjectUrl) URL.revokeObjectURL(state.localObjectUrl);
  state.localObjectUrl = "";
  dom.localPlayer.pause();
  dom.localPlayer.removeAttribute("src");
  dom.localPlayer.load();
  dom.localPlayer.hidden = true;
}

function handleLocalMetadata() {
  if (!state.selectedAudio || !state.localObjectUrl || dom.localPlayer.currentSrc !== state.localObjectUrl) return;
  if (Number.isFinite(dom.localPlayer.duration)) {
    state.audioDuration = dom.localPlayer.duration;
    state.audioLoadFailed = false;
    showLocalExcerpt();
  }
}

function handleLocalAudioError() {
  if (!state.selectedAudio || !state.localObjectUrl || dom.localPlayer.currentSrc !== state.localObjectUrl) return;
  state.audioLoadFailed = true;
  dom.localMessage.textContent = "This audio file could not be played by the browser. Choose another MP3 or WAV.";
  dom.localMessage.classList.add("is-error");
}

function ensureLocalAudioDuration() {
  if (state.audioLoadFailed) return Promise.reject(new Error("This audio file could not be played by the browser."));
  if (Number.isFinite(state.audioDuration) && state.audioDuration > 0) return Promise.resolve(state.audioDuration);
  if (!state.localObjectUrl) return Promise.reject(new Error("The selected audio file is not ready."));

  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      window.clearTimeout(timeout);
      dom.localPlayer.removeEventListener("loadedmetadata", onMetadata);
      dom.localPlayer.removeEventListener("error", onError);
      callback(value);
    };
    const onMetadata = () => {
      const duration = dom.localPlayer.duration;
      if (Number.isFinite(duration) && duration > 0) {
        state.audioDuration = duration;
        state.audioLoadFailed = false;
        finish(resolve, duration);
      } else {
        finish(reject, new Error("The browser could not read this track's duration."));
      }
    };
    const onError = () => finish(reject, new Error("This audio file could not be played by the browser."));
    const timeout = window.setTimeout(() => finish(reject, new Error("The browser could not read this track's duration. Try another MP3 or WAV.")), 10000);

    if (dom.localPlayer.readyState >= HTMLMediaElement.HAVE_METADATA) {
      onMetadata();
      return;
    }
    dom.localPlayer.addEventListener("loadedmetadata", onMetadata);
    dom.localPlayer.addEventListener("error", onError);
  });
}

function handleExcerptInput() {
  clearFormMessage();
  updateExcerptHelp();
}

function updateExcerptHelp() {
  if (!dom.excerptHelp) return;
  const start = parseTimestamp(dom.excerptStart.value);
  const duration = parseTimestamp(dom.excerptDuration.value);
  if (start === null || !duration || !Number.isSafeInteger(start + duration)) {
    dom.excerptHelp.textContent = "Use a start time and a positive duration, such as 0:32 and 0:15.";
    return;
  }
  dom.excerptHelp.textContent = `Selected range: ${formatTime(start)}–${formatTime(start + duration)}.`;
}

function refreshYoutubeExcerptPreview() {
  if (state.activeMode !== "youtube") return;
  const videoId = extractYoutubeId(dom.youtubeUrl.value);
  if (!videoId) return;
  state.previewVideoId = "";
  renderYoutubePreview(videoId);
}

function stopComposerPlayback() {
  if (!dom.localPlayer.paused) dom.localPlayer.pause();
  clearYoutubePreview();
  stopAudioVisualization();
}

function setMode(mode, options = {}) {
  if (mode !== "local" && mode !== "youtube") return;
  const changed = state.activeMode !== mode;
  if (changed && state.activeMode === "local") {
    if (!dom.localPlayer.paused) dom.localPlayer.pause();
    stopAudioVisualization();
  }
  if (changed && state.activeMode === "youtube") clearYoutubePreview();
  state.activeMode = mode;

  $$(".source-option").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  dom.localPanel.hidden = mode !== "local";
  dom.youtubePanel.hidden = mode !== "youtube";

  if (mode === "youtube" && !options.initial && dom.youtubeUrl.value.trim()) {
    scheduleYoutubeLookup();
  }
  updateExcerptHelp();
  clearFormMessage();
}

function clearYoutubePreview() {
  dom.youtubePreview.replaceChildren();
  dom.youtubePreview.hidden = true;
  state.previewVideoId = "";
}

function handleYoutubeInput() {
  clearFormMessage();
  scheduleYoutubeLookup();
}

function scheduleYoutubeLookup() {
  window.clearTimeout(state.metadataTimer);
  const trimmed = dom.youtubeUrl.value.trim();
  if (!trimmed) {
    state.metadata = null;
    state.metadataRequest += 1;
    clearYoutubePreview();
    clearMetadataCard();
    setYoutubeStatus("Add a link to look up its details.");
    return;
  }
  const videoId = extractYoutubeId(trimmed);
  if (!videoId) {
    state.metadata = null;
    state.metadataRequest += 1;
    clearYoutubePreview();
    clearMetadataCard();
    setYoutubeStatus("Enter a valid YouTube watch, Shorts, embed, live, or youtu.be link.", true);
    return;
  }

  renderYoutubePreview(videoId);
  setYoutubeStatus("Finding the title and channel…");
  const requestId = ++state.metadataRequest;
  state.metadataTimer = window.setTimeout(() => fetchYoutubeMetadata(videoId, requestId), 350);
}

function extractYoutubeId(rawValue) {
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    return "";
  }
  if (!["https:", "http:"].includes(url.protocol)) return "";
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (hostname === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(hostname)) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch" || url.pathname === "/") id = url.searchParams.get("v") || "";
    else if (["shorts", "embed", "live"].includes(segments[0])) id = segments[1] || "";
  }
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
}

function renderYoutubePreview(videoId) {
  if (state.previewVideoId === videoId && dom.youtubePreview.firstElementChild) {
    dom.youtubePreview.hidden = false;
    return;
  }
  const frame = document.createElement("iframe");
  const start = parseTimestamp(dom.excerptStart.value) || 0;
  const duration = parseTimestamp(dom.excerptDuration.value) || 15;
  const end = Number.isSafeInteger(start + duration) ? start + duration : 15;
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?start=${start}&end=${end}&rel=0`;
  frame.title = "YouTube soundtrack preview";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  dom.youtubePreview.replaceChildren(frame);
  dom.youtubePreview.hidden = false;
  state.previewVideoId = videoId;
}

async function fetchYoutubeMetadata(videoId, requestId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
    if (!response.ok) throw new Error("Metadata is unavailable");
    const data = await response.json();
    if (requestId !== state.metadataRequest) return;
    state.metadata = {
      videoId,
      title: typeof data.title === "string" ? data.title : "",
      channel: typeof data.author_name === "string" ? data.author_name : "",
      thumbnailUrl: safeThumbnailUrl(data.thumbnail_url),
    };
    renderMetadataCard(state.metadata);
    setYoutubeStatus("Track details found.");
  } catch {
    if (requestId !== state.metadataRequest) return;
    state.metadata = null;
    setYoutubeStatus("Details are unavailable in this browser. This valid link can still be saved.");
  }
}

function safeThumbnailUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" && /(^|\.)ytimg\.com$/.test(parsed.hostname) ? parsed.href : "";
  } catch {
    return "";
  }
}

function setYoutubeStatus(message, isError = false) {
  dom.youtubeStatus.textContent = message;
  dom.youtubeStatus.classList.toggle("is-error", isError);
}

function clearMetadataCard() {
  dom.youtubeStatus.parentElement?.querySelector(".metadata-card")?.remove();
}

function renderMetadataCard(details) {
  clearMetadataCard();
  const card = document.createElement("div");
  card.className = "metadata-card";
  if (details.thumbnailUrl) {
    const image = document.createElement("img");
    image.className = "metadata-thumb";
    image.src = details.thumbnailUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    card.append(image);
  }
  const copy = document.createElement("div");
  copy.className = "metadata-copy";
  const title = document.createElement("span");
  title.className = "metadata-title";
  title.textContent = details.title || "YouTube video";
  const channel = document.createElement("span");
  channel.className = "metadata-channel";
  channel.textContent = details.channel || "Channel unavailable";
  copy.append(title, channel);
  card.append(copy);
  dom.youtubeStatus.after(card);
}

function addPhotos(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let added = 0;
  const rejected = [];
  for (const file of files) {
    if (!isImageFile(file)) {
      rejected.push(file.name);
      continue;
    }
    const photo = {
      id: createId(),
      name: file.name,
      type: file.type || "image/jpeg",
      blob: file,
      url: URL.createObjectURL(file),
    };
    state.photos.push(photo);
    if (!state.coverPhotoId) state.coverPhotoId = photo.id;
    added += 1;
  }
  renderPhotoGrid();
  const count = state.photos.length;
  const countLabel = `${count} ${count === 1 ? "photograph" : "photographs"} selected.`;
  dom.photoStatus.textContent = rejected.length
    ? `${countLabel} Skipped ${rejected.length} non-image ${rejected.length === 1 ? "file" : "files"}.`
    : added ? countLabel : "Choose image files to add frames.";
  dom.photoStatus.classList.toggle("is-error", rejected.length > 0);
  clearFormMessage();
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

function renderPhotoGrid() {
  if (!dom.photoGrid) return;
  const cards = state.photos.map((photo, index) => {
    const card = document.createElement("article");
    card.className = "photo-card";
    card.draggable = true;
    card.dataset.photoId = photo.id;
    card.style.animationDelay = `${Math.min(index, 8) * 35}ms`;

    const preview = document.createElement("button");
    preview.className = "photo-preview";
    preview.type = "button";
    preview.dataset.photoAction = "preview";
    preview.dataset.photoId = photo.id;
    preview.setAttribute("aria-label", `Enlarge ${photo.name}`);
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = photo.name;
    image.loading = "lazy";
    preview.append(image);

    const footer = document.createElement("div");
    footer.className = "photo-card-footer";
    const indexLabel = document.createElement("span");
    indexLabel.className = "photo-index";
    indexLabel.textContent = String(index + 1).padStart(2, "0");
    const controls = document.createElement("div");
    controls.className = "photo-card-controls";

    if (photo.id === state.coverPhotoId) {
      const cover = document.createElement("span");
      cover.className = "cover-label";
      cover.textContent = "Cover";
      cover.setAttribute("aria-label", "Cover photograph");
      controls.append(cover);
    } else {
      controls.append(photoActionButton("cover", photo.id, "Set as cover"));
    }
    controls.append(photoActionButton("move-left", photo.id, "Move photograph earlier"));
    controls.append(photoActionButton("move-right", photo.id, "Move photograph later"));
    controls.append(photoActionButton("remove", photo.id, "Remove photograph"));
    footer.append(indexLabel, controls);
    card.append(preview, footer);
    return card;
  });
  dom.photoGrid.replaceChildren(...cards);
}

function photoActionButton(action, photoId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.photoAction = action;
  button.dataset.photoId = photoId;
  button.className = `photo-action photo-action-${action}`;
  button.setAttribute("aria-label", label);
  if (action === "cover") button.textContent = "Cover";
  else if (action === "move-left") button.textContent = "←";
  else if (action === "move-right") button.textContent = "→";
  else button.textContent = "×";
  return button;
}

function handlePhotoAction(event) {
  const button = event.target.closest("[data-photo-action]");
  if (!button) return;
  const index = state.photos.findIndex((photo) => photo.id === button.dataset.photoId);
  if (index < 0) return;
  const { photoAction: action, photoId } = button.dataset;
  if (action === "cover") state.coverPhotoId = photoId;
  if (action === "remove") {
    const [removed] = state.photos.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    if (state.coverPhotoId === photoId) state.coverPhotoId = state.photos[0]?.id || "";
  }
  if (action === "move-left" && index > 0) {
    [state.photos[index - 1], state.photos[index]] = [state.photos[index], state.photos[index - 1]];
  }
  if (action === "move-right" && index < state.photos.length - 1) {
    [state.photos[index + 1], state.photos[index]] = [state.photos[index], state.photos[index + 1]];
  }
  if (action === "preview") {
    openPhotoPreview(state.photos[index]);
    return;
  }
  renderPhotoGrid();
  dom.photoStatus.textContent = state.photos.length
    ? `${state.photos.length} ${state.photos.length === 1 ? "photograph" : "photographs"} selected.`
    : "No photographs added yet.";
}

function openPhotoPreview(photo) {
  if (!dom.photoLightbox || !dom.photoLightboxImage) return;
  if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
  state.photoPreviewUrl = URL.createObjectURL(photo.blob);
  dom.photoLightboxImage.src = state.photoPreviewUrl;
  dom.photoLightboxImage.alt = photo.name;
  dom.photoLightbox.showModal();
}

function handlePhotoDragStart(event) {
  const card = event.target.closest(".photo-card");
  if (!card) return;
  state.draggedPhotoId = card.dataset.photoId || "";
  card.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.draggedPhotoId);
  }
}

function handlePhotoDragOver(event) {
  const card = event.target.closest(".photo-card");
  if (event.dataTransfer?.types?.includes("Files")) return;
  if (!card || card.dataset.photoId === state.draggedPhotoId) return;
  event.preventDefault();
  $$(".photo-card.is-drop-target", dom.photoGrid).forEach((item) => item.classList.remove("is-drop-target"));
  card.classList.add("is-drop-target");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function handlePhotoDragLeave(event) {
  const card = event.target.closest(".photo-card");
  if (card && !card.contains(event.relatedTarget)) card.classList.remove("is-drop-target");
}

function handlePhotoDrop(event) {
  const files = event.dataTransfer?.files;
  if (files?.length) {
    event.preventDefault();
    addPhotos(files);
    clearDragState();
    return;
  }
  const targetCard = event.target.closest(".photo-card");
  if (!targetCard || !state.draggedPhotoId) return;
  event.preventDefault();
  const sourceIndex = state.photos.findIndex((photo) => photo.id === state.draggedPhotoId);
  const targetIndex = state.photos.findIndex((photo) => photo.id === targetCard.dataset.photoId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    clearDragState();
    return;
  }
  const [moved] = state.photos.splice(sourceIndex, 1);
  const targetRect = targetCard.getBoundingClientRect();
  const after = event.clientX > targetRect.left + targetRect.width / 2;
  const insertionIndex = targetIndex + (after ? 1 : 0);
  state.photos.splice(insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex, 0, moved);
  renderPhotoGrid();
  clearDragState();
}

function clearDragState() {
  state.draggedPhotoId = "";
  $$(".photo-card.is-dragging, .photo-card.is-drop-target", dom.photoGrid).forEach((card) => {
    card.classList.remove("is-dragging", "is-drop-target");
  });
}

function releasePhotoUrls(photos) {
  photos.forEach((photo) => {
    if (photo.url) URL.revokeObjectURL(photo.url);
  });
}

function handleArchiveAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "view") {
    const record = state.records.find((item) => item.id === id);
    if (record) openPresentation(record);
  } else if (action === "edit") {
    const record = state.records.find((item) => item.id === id);
    if (record) editMemory(record);
  } else if (action === "delete") {
    deleteArchiveMemory(id, button);
  } else if (action === "clear-filters") {
    dom.archiveSearch.value = "";
    dom.archiveDateFilter.value = "";
    renderArchive();
  } else if (action === "create") {
    startNewMemory();
  }
}

async function deleteArchiveMemory(id, button) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  const title = record.title || suggestTitle(record.memory) || "this memory";
  if (!window.confirm(`Delete “${title}” and its saved photographs and audio from this browser? This cannot be undone.`)) return;
  button.disabled = true;
  setArchiveMessage("");
  try {
    await deleteMemory(id);
    state.records = state.records.filter((item) => item.id !== id);
    renderArchive();
    setArchiveMessage("Memory deleted from this browser.");
  } catch (error) {
    button.disabled = false;
    setArchiveMessage(error.message || "Could not delete this memory. Please try again.", true);
  }
}

async function editMemory(record) {
  if (hasUnsavedDraft() && !window.confirm("Replace this draft with the selected memory? Unsaved changes will be lost.")) return;
  closePresentation();
  resetDraft();
  state.editId = record.id;
  state.titleWasEdited = Boolean(record.title);
  dom.title.value = record.title || suggestTitle(record.memory);
  dom.story.value = record.memory || "";
  $("#music-description").value = record.musicDescription || "";
  dom.date.value = record.date || localDateString(new Date());
  setMood(record.mood || "");
  dom.excerptStart.value = formatTime(record.startTime ?? record.excerptStart ?? 0);
  dom.excerptDuration.value = formatTime(record.excerptDuration || 15);
  state.photos = (Array.isArray(record.photos) ? record.photos : []).filter((photo) => photo?.blob instanceof Blob).map((photo) => ({
    id: photo.id || createId(),
    name: photo.name || "Photograph",
    type: photo.type || photo.blob.type || "image/jpeg",
    blob: photo.blob,
    url: URL.createObjectURL(photo.blob),
  }));
  state.coverPhotoId = record.coverPhotoId && state.photos.some((photo) => photo.id === record.coverPhotoId)
    ? record.coverPhotoId
    : state.photos[0]?.id || "";
  renderPhotoGrid();
  dom.photoStatus.textContent = state.photos.length
    ? `${state.photos.length} ${state.photos.length === 1 ? "photograph" : "photographs"} selected.`
    : "No photographs added yet.";

  const sourceType = record.sourceType === "youtube" ? "youtube" : "local";
  if (sourceType === "local" && record.audioBlob instanceof Blob) {
    state.selectedAudio = record.audioBlob;
    state.audioFileName = record.fileName || "Saved audio";
    state.audioDuration = Number(record.audioDuration) || 0;
    state.audioArtist = record.channel || "";
    dom.localTrackTitle.value = record.trackTitle || readableTitle(state.audioFileName);
    state.trackTitleEdited = true;
    if (record.excerptDuration > 0) {
      state.audioMoment = { startTime: record.startTime ?? record.excerptStart ?? 0, excerptDuration: record.excerptDuration, beatMap: record.beatMap || [] };
    } else {
      const blob = record.audioBlob;
      state.audioAnalysis = (blob.size <= 50 * 1024 * 1024 ? findBestAudioMoment(blob, 15) : Promise.reject())
        .catch(() => ({ startTime: 0, excerptDuration: 15, beatMap: [] })).then((moment) => {
          if (state.selectedAudio !== blob) return;
          state.audioMoment = moment;
          showLocalExcerpt();
        });
    }
    state.localObjectUrl = URL.createObjectURL(record.audioBlob);
    dom.localPlayer.src = state.localObjectUrl;
    dom.fileName.textContent = state.audioFileName;
    dom.localMessage.textContent = "Finding the saved excerpt…";
  } else {
    dom.youtubeUrl.value = record.sourceUrl || "";
    state.metadata = record.trackTitle ? {
      videoId: extractYoutubeId(record.sourceUrl || ""),
      title: record.trackTitle,
      channel: record.channel || "",
      thumbnailUrl: safeThumbnailUrl(record.thumbnailUrl || ""),
    } : null;
  }
  updateCharacterCount();
  dom.saveButton.querySelector("span").textContent = "Save changes";
  setStage("story");
  setScreen("create");
  setMode(sourceType);
  dom.story.focus({ preventScroll: true });
}

function archiveRecordsMatchingFilters() {
  const query = dom.archiveSearch.value.trim().toLocaleLowerCase();
  const date = dom.archiveDateFilter.value;
  return state.records.filter((record) => {
    if (date && record.date !== date) return false;
    if (!query) return true;
    const searchable = [
      record.title || suggestTitle(record.memory),
      record.memory,
      record.mood,
      record.trackTitle,
      record.channel,
      record.date,
    ].join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}

async function loadArchive() {
  dom.archiveContent.setAttribute("aria-busy", "true");
  renderArchiveLoading();
  try {
    state.records = (await getMemories()).sort((a, b) => {
      const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
      return dateCompare || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    dom.archiveContent.setAttribute("aria-busy", "false");
    renderArchive();
  } catch (error) {
    dom.archiveContent.setAttribute("aria-busy", "false");
    dom.archiveCount.textContent = "—";
    releaseArchiveObjectUrls();
    const message = document.createElement("p");
    message.className = "archive-error";
    message.textContent = error.message || "Your archive could not be opened in this browser.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadArchive);
    dom.archiveContent.replaceChildren(message, retry);
  }
}

function renderArchiveLoading() {
  releaseArchiveObjectUrls();
  dom.archiveCount.textContent = "…";
  dom.archiveContent.setAttribute("aria-busy", "true");
}

function renderArchive() {
  releaseArchiveObjectUrls();
  const records = archiveRecordsMatchingFilters();
  dom.archiveCount.textContent = String(records.length).padStart(2, "0");
  dom.archiveContent.setAttribute("aria-busy", "false");

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const ornament = document.createElement("div");
    ornament.className = "empty-ornament";
    ornament.setAttribute("aria-hidden", "true");
    const title = document.createElement("h3");
    const copy = document.createElement("p");
    const create = document.createElement("button");
    create.type = "button";
    create.className = "empty-create-action";
    create.dataset.action = "create";

    const hasFilters = Boolean(dom.archiveSearch.value.trim() || dom.archiveDateFilter.value);
    title.textContent = hasFilters ? "No days match just yet." : "Nothing held here yet.";
    copy.textContent = hasFilters
      ? "Try another title, song, or date to find a memory."
      : "Save a few words, photographs and a song. They will stay together here, on this device.";
    create.textContent = hasFilters ? "Clear the filters" : "Make your first memory";
    create.dataset.action = hasFilters ? "clear-filters" : "create";
    empty.append(ornament, title, copy, create);
    dom.archiveContent.replaceChildren(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "memory-list";
  records.forEach((record, index) => list.append(createMemoryCard(record, index)));
  dom.archiveContent.replaceChildren(list);
}

function createMemoryCard(record, index) {
  const card = document.createElement("article");
  card.className = "memory-card";
  card.dataset.mood = moodClass(record.mood);
  applyAtmosphere(card, record.atmosphere);
  card.style.animationDelay = `${Math.min(index, 8) * 40}ms`;
  card.dataset.memoryId = record.id;

  const photos = Array.isArray(record.photos) ? record.photos : [];
  const cover = photos.find((photo) => photo.id === record.coverPhotoId && photo.blob instanceof Blob)
    || photos.find((photo) => photo.blob instanceof Blob);
  const open = document.createElement("button");
  open.type = "button";
  open.className = "memory-cover-button";
  open.dataset.action = "view";
  open.dataset.id = record.id;
  open.setAttribute("aria-label", `Open ${record.title || suggestTitle(record.memory) || "memory"} from ${formatDate(record.date)}`);
  if (cover) {
    const image = document.createElement("img");
    image.className = "memory-cover";
    image.src = createArchiveObjectUrl(cover.blob);
    image.alt = cover.name || "";
    image.loading = "lazy";
    open.append(image);
  } else {
    const blank = document.createElement("span");
    blank.className = "memory-cover-empty";
    blank.setAttribute("aria-hidden", "true");
    open.append(blank);
  }
  const coverLabel = document.createElement("span");
  coverLabel.className = "memory-cover-caption";
  coverLabel.textContent = `${photos.length ? `${String(photos.length).padStart(2, "0")} FRAMES` : "SOUND MEMORY"} · OPEN`;
  open.append(coverLabel);

  const body = document.createElement("div");
  body.className = "memory-card-body";
  const header = document.createElement("div");
  header.className = "memory-card-top";
  const date = document.createElement("time");
  date.dateTime = record.date || "";
  date.textContent = formatDate(record.date);
  const mood = document.createElement("span");
  mood.className = "memory-mood";
  mood.textContent = `${record.demo ? "DEMO · " : ""}${record.atmosphere?.label || record.mood || "A day, kept"}`;
  header.append(date, mood);

  const title = document.createElement("h3");
  title.className = "memory-card-title";
  title.textContent = record.title || suggestTitle(record.memory) || "A day, kept";
  const story = document.createElement("p");
  story.className = "memory-text";
  story.textContent = record.memory || "";

  const track = document.createElement("div");
  track.className = "memory-track";
  const art = document.createElement("div");
  art.className = `track-art${record.sourceType === "local" ? " local-art" : ""}`;
  const thumbnail = record.sourceType === "youtube" ? safeThumbnailUrl(record.thumbnailUrl || "") : "";
  if (thumbnail) {
    const image = document.createElement("img");
    image.src = thumbnail;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    art.append(image);
  } else {
    const mark = document.createElement("span");
    mark.className = "track-art-mark";
    mark.textContent = "d.";
    art.append(mark);
  }
  const details = document.createElement("div");
  details.className = "track-details";
  const trackTitle = document.createElement("span");
  trackTitle.className = "track-title";
  trackTitle.textContent = record.trackTitle || "YouTube video";
  const byline = document.createElement("span");
  byline.className = "track-byline";
  byline.textContent = record.sourceType === "local" ? record.fileName || "Local audio" : record.channel || "YouTube";
  details.append(trackTitle, byline);
  track.append(art, details);

  const actions = document.createElement("div");
  actions.className = "memory-actions";
  actions.append(
    archiveButton("edit", record.id, "Edit", `Edit ${title.textContent}`),
    archiveButton("delete", record.id, "Delete", `Delete ${title.textContent}`),
  );

  body.append(header, actions, title, story, track);
  card.append(open, body);
  return card;
}

function archiveButton(action, id, label, accessibleLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action === "delete" ? "delete-button" : "edit-button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  return button;
}

function createArchiveObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.archiveObjectUrls.push(url);
  return url;
}

function releaseArchiveObjectUrls() {
  state.archiveObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.archiveObjectUrls = [];
}

function setArchiveMessage(message, isError = false) {
  if (!dom.archiveMessage) return;
  dom.archiveMessage.textContent = message;
  dom.archiveMessage.classList.toggle("is-error", isError);
}

function formatDate(value) {
  if (!value) return "Date not set";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Date not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseTimestamp(value) {
  const input = String(value || "").trim();
  if (!input) return 0;
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(input)) return null;
  const segments = input.split(":").map(Number);
  if (segments.slice(1).some((segment) => segment >= 60)) return null;
  return segments.reduce((total, part) => total * 60 + part, 0);
}

async function saveMemory(event) {
  event.preventDefault();
  if (state.saveInProgress) return;
  clearFormMessage();
  if (!validateStory() || !validatePhotos()) return;

  let music;
  if (state.activeMode === "local") {
    if (!(state.selectedAudio instanceof Blob) || !state.selectedAudio.size) {
      setStage("soundtrack");
      setFormMessage("Choose an MP3 or WAV for this memory.", true);
      dom.audioFile.focus();
      return;
    }
    state.saveInProgress = true;
    dom.form.inert = true;
    dom.saveButton.disabled = true;
    dom.saveButton.querySelector("span").textContent = "Checking the track…";
    let excerpt;
    try {
      await ensureLocalAudioDuration();
      await state.audioAnalysis;
      excerpt = localExcerpt();
      if (!excerpt || state.audioLoadFailed) throw new Error("The browser could not prepare this audio file.");
    } catch (error) {
      setStage("soundtrack");
      setFormMessage(error.message || "The browser could not read this audio file.", true);
      return;
    } finally {
      state.saveInProgress = false;
      dom.form.inert = false;
      dom.saveButton.disabled = false;
      dom.saveButton.querySelector("span").textContent = state.editId ? "Save changes" : "Save this memory";
    }
    music = {
      ...excerpt,
      sourceType: "local",
      trackTitle: dom.localTrackTitle.value.trim() || readableTitle(state.audioFileName || "Local audio"),
      channel: state.audioArtist,
      thumbnailUrl: "",
      audioBlob: state.selectedAudio,
      audioDuration: state.audioDuration,
      fileName: state.audioFileName,
      sourceUrl: "",
    };
  } else {
    const videoId = extractYoutubeId(dom.youtubeUrl.value);
    if (!videoId) {
      setStage("soundtrack");
      setFormMessage("Add a valid YouTube link for this memory.", true);
      dom.youtubeUrl.focus();
      return;
    }
    const startTime = parseTimestamp(dom.excerptStart.value);
    const excerptDuration = parseTimestamp(dom.excerptDuration.value);
    if (startTime === null || !excerptDuration || !Number.isSafeInteger(startTime + excerptDuration)) {
      setStage("soundtrack");
      setFormMessage("Enter a valid start time and a positive duration, such as 0:32 and 0:15.", true);
      (startTime === null ? dom.excerptStart : dom.excerptDuration).focus();
      return;
    }
    const meta = state.metadata?.videoId === videoId ? state.metadata : null;
    music = {
      startTime,
      excerptDuration,
      beatMap: [],
      sourceType: "youtube",
      trackTitle: meta?.title || "YouTube video",
      channel: meta?.channel || "",
      thumbnailUrl: meta?.thumbnailUrl || "",
      audioBlob: null,
      audioDuration: 0,
      fileName: "",
      sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    };
  }

  if (state.activeMode === "youtube" && !window.confirm("YouTube playback needs an internet connection and may be unavailable in some regions. Save this link with the memory?")) return;

  const existing = state.records.find((record) => record.id === state.editId);
  const title = dom.title.value.trim() || suggestTitle(dom.story.value) || "A day, kept";
  const memory = {
    ...music,
    id: state.editId || createId(),
    title,
    memory: dom.story.value.trim(),
    date: dom.date.value,
    mood: dom.mood.value || "",
    musicDescription: $("#music-description").value.trim(),
    demo: existing?.demo || false,
    photos: state.photos.map((photo) => Object.fromEntries(
      DB_IMAGE_FIELDS.map((field) => [field, field === "blob" ? photo.blob : photo[field]]),
    )),
    coverPhotoId: state.coverPhotoId || state.photos[0]?.id || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.saveInProgress = true;
  dom.form.inert = true;
  dom.saveButton.disabled = true;
  dom.saveButton.querySelector("span").textContent = state.editId ? "Saving changes…" : "Keeping this memory…";
  try {
    memory.atmosphere = composeAtmosphere(memory, await samplePhotos(memory.photos));
    await putMemory(memory);
    const successMessage = state.editId ? "Changes saved." : "Memory saved to your archive.";
    resetDraft();
    state.editId = null;
    state.records = (await getMemories()).sort((a, b) => {
      const byDate = String(b.date || "").localeCompare(String(a.date || ""));
      return byDate || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    dom.archiveSearch.value = "";
    dom.archiveDateFilter.value = "";
    setArchiveMessage(successMessage);
    setScreen("archive");
    renderArchive();
    $("#archive-title")?.focus({ preventScroll: true });
  } catch (error) {
    setFormMessage(error.message || "This memory could not be saved. Check this browser's storage and try again.", true);
  } finally {
    state.saveInProgress = false;
    dom.form.inert = false;
    dom.saveButton.disabled = false;
    dom.saveButton.querySelector("span").textContent = state.editId ? "Save changes" : "Save this memory";
  }
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openPresentation(record) {
  stopComposerPlayback();
  closePresentation();
  state.presentationRecord = record;
  state.presentationKind = record.sourceType === "youtube" ? "youtube" : "local";
  const savedPhotos = Array.isArray(record.photos) ? record.photos.filter((photo) => photo?.blob instanceof Blob) : [];
  state.presentationPhotos = savedPhotos.map((photo) => ({
    id: photo.id || createId(),
    name: photo.name || "Memory photograph",
    blob: photo.blob,
    url: URL.createObjectURL(photo.blob),
  }));
  const coverIndex = state.presentationPhotos.findIndex((photo) => photo.id === record.coverPhotoId);
  const startIndex = coverIndex >= 0 ? coverIndex : 0;
  state.presentationSequence = state.presentationPhotos.map((_, index) => index);
  if (startIndex > 0) {
    state.presentationSequence = [
      ...state.presentationSequence.slice(startIndex),
      ...state.presentationSequence.slice(0, startIndex),
    ];
  }
  state.presentationFrame = 0;
  state.presentationStart = Math.max(0, Number(record.startTime ?? record.excerptStart) || 0);
  // Legacy records remain readable; they had a start but no saved duration.
  state.presentationDuration = Number(record.excerptDuration) > 0 ? Number(record.excerptDuration)
    : state.presentationKind === "local" ? Math.max(0, (Number(record.audioDuration) || 0) - state.presentationStart) : 15;
  state.presentationEnded = false;
  updatePresentationSchedule();
  state.youtubePlayerReady = false;
  state.youtubePlayerPromise = null;

  dom.presentationTitle.textContent = record.title || suggestTitle(record.memory) || "A day, kept";
  dom.presentationStory.textContent = record.memory || "";
  dom.presentationDate.textContent = `${formatDate(record.date)}${record.mood ? ` · ${record.mood}` : ""}`;
  dom.memoryDialog.dataset.mood = moodClass(record.mood);
  applyAtmosphere(dom.memoryDialog, record.atmosphere);
  $("#presentation-explanation").textContent = record.atmosphere?.explanation
    || "This is an older saved day. Edit and save it to analyse its photos, story and soundtrack.";
  dom.presentationTrack.textContent = `${record.trackTitle || "YouTube video"}${record.channel ? ` · ${record.channel}` : ""}`;
  if (dom.presentationOpenYoutube) {
    const isYoutube = state.presentationKind === "youtube" && Boolean(record.sourceUrl);
    dom.presentationOpenYoutube.hidden = !isYoutube;
    if (isYoutube) dom.presentationOpenYoutube.href = record.sourceUrl;
    else dom.presentationOpenYoutube.removeAttribute("href");
  }
  dom.presentationStatus.textContent = state.presentationPhotos.length
    ? presentationPacing()
    : "Soundtrack and story only · no photographs were added.";
  if (dom.presentationEmpty) {
    dom.presentationEmpty.hidden = state.presentationPhotos.length > 0;
    dom.presentationEmptyTitle.textContent = dom.presentationTitle.textContent;
  }
  dom.presentationProgress.min = "0";
  dom.presentationProgress.max = String(state.presentationDuration || 100);
  dom.presentationProgress.value = "0";
  dom.presentationPlay.setAttribute("aria-pressed", "false");
  dom.presentationTime.textContent = state.presentationDuration
    ? `0:00 / ${formatTime(state.presentationDuration)}`
    : "Play to begin";
  dom.presentationPrev.hidden = state.presentationPhotos.length < 2;
  dom.presentationNext.hidden = state.presentationPhotos.length < 2;
  dom.presentationImage.hidden = !state.presentationPhotos.length;
  dom.presentationIndicator.hidden = !state.presentationPhotos.length;

  if (state.presentationPhotos.length) renderPresentationFrame(0);
  else {
    dom.presentationImage.removeAttribute("src");
    dom.presentationImage.alt = "";
  }
  dom.presentationYoutube.replaceChildren();
  dom.presentationYoutube.hidden = true;
  dom.presentationAudio.pause();
  dom.presentationAudio.removeAttribute("src");
  dom.presentationAudio.load();

  if (state.presentationKind === "local" && record.audioBlob instanceof Blob) {
    state.presentationAudioUrl = URL.createObjectURL(record.audioBlob);
    dom.presentationAudio.src = state.presentationAudioUrl;
    dom.presentationAudio.load();
  }
  dom.memoryDialog.showModal();
}

function moodClass(mood) {
  const value = String(mood || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return value || "none";
}

function renderPresentationFrame(sequencePosition) {
  const count = state.presentationSequence.length;
  if (!count) {
    dom.presentationImage.hidden = true;
    dom.presentationIndicator.hidden = true;
    if (dom.presentationEmpty) dom.presentationEmpty.hidden = false;
    return;
  }
  if (dom.presentationEmpty) dom.presentationEmpty.hidden = true;
  dom.presentationIndicator.hidden = false;
  state.presentationFrame = (sequencePosition + count) % count;
  const photoIndex = state.presentationSequence[state.presentationFrame];
  const photo = state.presentationPhotos[photoIndex];
  dom.presentationImage.hidden = false;
  dom.presentationImage.classList.add("is-changing");
  dom.presentationImage.src = photo.url;
  dom.presentationImage.alt = photo.name;
  dom.presentationIndicator.textContent = `${String(state.presentationFrame + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`;
  window.setTimeout(() => dom.presentationImage.classList.remove("is-changing"), 320);
}

function stepPresentationFrame(amount) {
  if (state.presentationSequence.length < 2) return;
  const count = state.presentationSequence.length;
  const target = (state.presentationFrame + amount + count) % count;
  const elapsed = state.presentationSchedule.times[target - 1] ?? 0;
  renderPresentationFrame(target);
  dom.presentationProgress.value = String(elapsed);
  seekPresentation();
}

function togglePresentationPlayback() {
  if (!state.presentationRecord) return;
  stopNarration();
  if (state.presentationKind === "local") {
    if (dom.presentationAudio.paused) playLocalPresentation();
    else dom.presentationAudio.pause();
  } else if (state.youtubePlayer && state.youtubePlayerReady) {
    const playerState = state.youtubePlayer.getPlayerState();
    if (playerState === window.YT.PlayerState.PLAYING) state.youtubePlayer.pauseVideo();
    else {
      if (state.presentationEnded) state.youtubePlayer.seekTo(state.presentationStart, true);
      state.presentationEnded = false;
      state.youtubePlayer.playVideo();
    }
  } else {
    playYoutubePresentation();
  }
}

async function playLocalPresentation() {
  if (!dom.presentationAudio.src) {
    setPresentationStatus("This memory has no saved local audio.");
    return;
  }
  const session = state.presentationSession;
  try {
    if (state.presentationEnded || dom.presentationAudio.ended || dom.presentationAudio.currentTime < state.presentationStart) {
      dom.presentationAudio.currentTime = state.presentationStart;
    }
    state.presentationEnded = false;
    await dom.presentationAudio.play();
    if (session === state.presentationSession) setPresentationStatus(presentationPacing());
  } catch {
    if (session === state.presentationSession) setPresentationStatus("Playback could not start. Use the play control again to retry.");
  }
}

async function playYoutubePresentation() {
  const session = state.presentationSession;
  const videoId = extractYoutubeId(state.presentationRecord?.sourceUrl || "");
  if (!videoId) {
    setPresentationStatus("This saved YouTube link is no longer valid.");
    return;
  }
  setPresentationStatus("Connecting to the YouTube player…");
  try {
    await loadYoutubeApi();
    if (!dom.memoryDialog.open || session !== state.presentationSession) return;
    if (state.youtubePlayer && state.youtubePlayerReady) {
      state.youtubePlayer.playVideo();
      return;
    }
    if (state.youtubePlayerPromise) return state.youtubePlayerPromise;
    state.youtubePlayerPromise = new Promise((resolve) => {
      dom.presentationYoutube.hidden = false;
      const mount = document.createElement("div");
      dom.presentationYoutube.replaceChildren(mount);
      state.youtubePlayer = new window.YT.Player(mount, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: {
          controls: 1,
          playsinline: 1,
          rel: 0,
          start: state.presentationStart,
          end: state.presentationStart + state.presentationDuration,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (session !== state.presentationSession) { resolve(null); return; }
            state.youtubePlayerReady = true;
            const duration = event.target.getDuration();
            if (duration > 0 && duration <= state.presentationStart) {
              setPresentationStatus("This excerpt starts after the video ends. Edit the memory to choose an earlier start.");
              resolve(event.target);
              return;
            }
            event.target.seekTo(state.presentationStart + (Number(dom.presentationProgress.value) || 0), true);
            event.target.playVideo();
            resolve(event.target);
          },
          onStateChange: (event) => { if (session === state.presentationSession) handleYoutubePlayerState(event); },
          onError: (event) => {
            if (session !== state.presentationSession) { resolve(null); return; }
            state.youtubePlayerReady = false;
            const descriptions = {
              2: "The saved start time is not valid for this video.",
              5: "This YouTube video cannot play in the browser player.",
              100: "The video was removed or made private.",
              101: "The owner does not allow this video to be embedded.",
              150: "The owner does not allow this video to be embedded.",
            };
            setPresentationStatus(descriptions[event.data] || "YouTube could not play this video.");
            resolve(null);
          },
        },
      });
    });
    await state.youtubePlayerPromise;
  } catch {
    if (dom.memoryDialog.open && session === state.presentationSession) {
      setPresentationStatus("The YouTube player could not load. Check the connection or open the saved link on YouTube.");
    }
  }
}

function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (state.youtubeApiPromise) return state.youtubeApiPromise;
  state.youtubeApiPromise = new Promise((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("YouTube player timed out.")), 15000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (typeof previousCallback === "function") {
        try {
          previousCallback();
        } catch {
          // A different embed's callback should not prevent DAYTONE from initializing.
        }
      }
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player API did not initialize."));
    };
    let script = $('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not load the YouTube player."));
      };
      document.head.append(script);
    }
  }).catch((error) => {
    state.youtubeApiPromise = null;
    throw error;
  });
  return state.youtubeApiPromise;
}

function handleYoutubePlayerState(event) {
  if (event.data === window.YT.PlayerState.PLAYING) {
    const position = event.target.getCurrentTime();
    if (state.presentationEnded || position < state.presentationStart - 0.05) event.target.seekTo(state.presentationStart, true);
    state.presentationEnded = false;
    setPresentationPlaying(true);
    setPresentationStatus(presentationPacing());
    if (!state.presentationTimer) {
      state.presentationTimer = window.setInterval(updateYoutubePresentation, 80);
    }
  } else if (event.data === window.YT.PlayerState.PAUSED) {
    setPresentationPlaying(false);
    clearPresentationTimer();
    updateYoutubePresentation();
  } else if (event.data === window.YT.PlayerState.ENDED) {
    clearPresentationTimer();
    finishPresentationPlayback();
  } else if (event.data === window.YT.PlayerState.BUFFERING) {
    setPresentationStatus("Buffering the YouTube soundtrack…");
  }
}

function updateYoutubePresentation() {
  if (!state.youtubePlayer || !state.youtubePlayerReady || state.presentationEnded) return;
  const player = state.youtubePlayer;
  const mediaDuration = player.getDuration();
  if (mediaDuration > 0 && mediaDuration <= state.presentationStart) {
    clearPresentationTimer();
    state.presentationEnded = true;
    player.pauseVideo();
    setPresentationPlaying(false);
    setPresentationStatus("This excerpt starts after the video ends. Edit the memory to choose an earlier start.");
    return;
  }
  clampPresentationDuration(mediaDuration);
  const position = player.getCurrentTime();
  if (position < state.presentationStart - 0.15 && player.getPlayerState() === window.YT.PlayerState.PLAYING) {
    player.seekTo(state.presentationStart, true);
  }
  const currentTime = Math.max(0, position - state.presentationStart);
  if (state.presentationDuration && currentTime >= state.presentationDuration) {
    finishPresentationPlayback();
    player.pauseVideo();
    return;
  }
  updatePresentationProgress(currentTime);
  syncFrameToTime(currentTime, state.presentationDuration);
}

function updateLocalPresentation() {
  if (state.presentationKind !== "local" || !dom.memoryDialog.open || state.presentationEnded) return;
  clampPresentationDuration(dom.presentationAudio.duration);
  const currentTime = Math.max(0, dom.presentationAudio.currentTime - state.presentationStart);
  if (state.presentationDuration && currentTime >= state.presentationDuration) {
    finishPresentationPlayback();
    dom.presentationAudio.pause();
    return;
  }
  updatePresentationProgress(currentTime);
  syncFrameToTime(currentTime, state.presentationDuration);
}

function clampPresentationDuration(mediaDuration) {
  const available = mediaDuration - state.presentationStart;
  if (!Number.isFinite(available) || available <= 0) return;
  const duration = Math.min(state.presentationDuration || available, available);
  if (duration === state.presentationDuration) return;
  state.presentationDuration = duration;
  updatePresentationSchedule();
}

function updatePresentationSchedule() {
  state.presentationSchedule = frameSchedule(state.presentationSequence.length, state.presentationDuration,
    state.presentationKind === "local" ? state.presentationRecord?.beatMap : []);
}

function presentationPacing() {
  if (state.presentationSequence.length < 2) return "";
  return state.presentationSchedule.detected ? "Frames follow approximate musical events." : "Frames move at an even pace with the soundtrack.";
}

function updatePresentationProgress(currentTime) {
  if (!state.presentationDuration) {
    dom.presentationTime.textContent = "Soundtrack length unavailable · frames paced evenly";
    return;
  }
  dom.presentationProgress.max = String(state.presentationDuration);
  dom.presentationProgress.value = String(Math.min(currentTime, state.presentationDuration));
  dom.presentationTime.textContent = `${formatTime(Math.min(currentTime, state.presentationDuration))} / ${formatTime(state.presentationDuration)}`;
}

function syncFrameToTime(currentTime, duration) {
  const count = state.presentationSequence.length;
  if (count < 2 || !duration) return;
  const target = state.presentationSchedule.times.filter((time) => currentTime + 0.005 >= time).length;
  if (target !== state.presentationFrame) renderPresentationFrame(target);
}

function seekPresentation() {
  const elapsed = Number(dom.presentationProgress.value) || 0;
  state.presentationEnded = false;
  updatePresentationProgress(elapsed);
  syncFrameToTime(elapsed, state.presentationDuration);
  if (state.presentationKind === "local" && dom.presentationAudio.src) {
    dom.presentationAudio.currentTime = state.presentationStart + elapsed;
  } else if (state.youtubePlayer && state.youtubePlayerReady) {
    state.youtubePlayer.seekTo(state.presentationStart + elapsed, true);
  }
}

function finishPresentationPlayback() {
  state.presentationEnded = true;
  setPresentationPlaying(false);
  clearPresentationTimer();
  if (state.presentationSequence.length) renderPresentationFrame(state.presentationSequence.length - 1);
  if (state.presentationDuration) updatePresentationProgress(state.presentationDuration);
}

function setPresentationPlaying(playing) {
  dom.presentationPlay.setAttribute("aria-pressed", String(playing));
  dom.presentationPlay.setAttribute("aria-label", playing ? "Pause memory soundtrack" : "Play memory soundtrack");
}

function setPresentationStatus(message) {
  if (dom.presentationStatus) dom.presentationStatus.textContent = message;
}

function clearPresentationTimer() {
  if (state.presentationTimer) window.clearInterval(state.presentationTimer);
  state.presentationTimer = 0;
}

function closePresentation() {
  if (dom.memoryDialog.open) dom.memoryDialog.close();
  stopPresentationPlayback();
}

function stopPresentationPlayback() {
  stopNarration();
  state.presentationSession += 1;
  clearPresentationTimer();
  dom.presentationAudio.pause();
  dom.presentationAudio.removeAttribute("src");
  dom.presentationAudio.load();
  if (state.presentationAudioUrl) URL.revokeObjectURL(state.presentationAudioUrl);
  state.presentationAudioUrl = "";
  try {
    state.youtubePlayer?.destroy();
  } catch {
    // The iframe API may not have finished initializing before the dialog closed.
  }
  state.youtubePlayer = null;
  state.youtubePlayerReady = false;
  state.youtubePlayerPromise = null;
  state.presentationRecord = null;
  state.presentationKind = "";
  dom.presentationYoutube.replaceChildren();
  dom.presentationYoutube.hidden = true;
  setPresentationPlaying(false);
  releasePresentationPhotoUrls();
}

function releasePresentationPhotoUrls() {
  state.presentationPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
  state.presentationPhotos = [];
  state.presentationSequence = [];
}

function startAudioVisualization() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || state.activeMode !== "local") return;
  try {
    if (!state.audioContext) {
      state.audioContext = new AudioContextClass();
      state.audioAnalyser = state.audioContext.createAnalyser();
      state.audioAnalyser.fftSize = 128;
      state.audioSource = state.audioContext.createMediaElementSource(dom.localPlayer);
      state.audioSource.connect(state.audioAnalyser);
      state.audioAnalyser.connect(state.audioContext.destination);
    }
    if (state.audioContext.state === "suspended") state.audioContext.resume();
    dom.audioVisualizer.hidden = false;
    if (state.visualizerFrame === null) drawAudioVisualization();
  } catch {
    dom.audioVisualizer.hidden = true;
    dom.localMessage.textContent = "Audio playback works; the live sound display is unavailable.";
  }
}

function drawAudioVisualization() {
  if (!state.audioAnalyser || dom.localPlayer.paused || state.activeMode !== "local") return;
  const context = dom.audioVisualizer.getContext("2d");
  if (!context) return;
  const bounds = dom.audioVisualizer.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(bounds.width * ratio));
  const height = Math.max(1, Math.floor(bounds.height * ratio));
  if (dom.audioVisualizer.width !== width || dom.audioVisualizer.height !== height) {
    dom.audioVisualizer.width = width;
    dom.audioVisualizer.height = height;
  }
  context.clearRect(0, 0, width, height);
  const spectrum = new Uint8Array(state.audioAnalyser.frequencyBinCount);
  state.audioAnalyser.getByteFrequencyData(spectrum);
  const count = 28;
  const gap = Math.max(2, Math.round(3 * ratio));
  const barWidth = (width - gap * (count - 1)) / count;
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--coral").trim() || "#bd7855";
  for (let index = 0; index < count; index += 1) {
    const bin = Math.floor(index * spectrum.length / count);
    const amplitude = spectrum[bin] / 255;
    const barHeight = Math.max(2 * ratio, amplitude * height * 0.86);
    context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
  }
  state.visualizerFrame = window.requestAnimationFrame(drawAudioVisualization);
}

function stopAudioVisualization() {
  if (state.visualizerFrame !== null) {
    window.cancelAnimationFrame(state.visualizerFrame);
    state.visualizerFrame = null;
  }
  if (dom.audioVisualizer) dom.audioVisualizer.hidden = true;
}

function stopNarration() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const button = $("#narrate-day");
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Read story aloud";
}

function narrateDay() {
  const record = state.presentationRecord;
  if (!record || !("speechSynthesis" in window)) return;
  const button = $("#narrate-day");
  if (button.getAttribute("aria-pressed") === "true") { stopNarration(); return; }
  dom.presentationAudio.pause();
  if (state.youtubePlayerReady) state.youtubePlayer?.pauseVideo();
  stopNarration();
  const utterance = new SpeechSynthesisUtterance(record.memory);
  utterance.lang = /[а-яё]/i.test(record.memory) ? "ru-RU" : "en-US";
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith(utterance.lang.slice(0, 2)));
  // Prefer on-device synthesis. Browser/OS determines which voices exist.
  utterance.voice = voices.find((voice) => voice.localService) || voices[0] || null;
  utterance.rate = record.atmosphere?.energy === "high" ? 1.08 : 0.88;
  utterance.pitch = record.atmosphere?.key === "tender" ? 1.05 : 1;
  utterance.onend = () => { button.setAttribute("aria-pressed", "false"); button.textContent = "Read story aloud"; };
  utterance.onerror = (event) => {
    utterance.onend();
    if (event.error !== "canceled" && event.error !== "interrupted") setPresentationStatus("Speech is unavailable in this browser. The written story is still available.");
  };
  button.setAttribute("aria-pressed", "true");
  button.textContent = "Stop narration";
  window.speechSynthesis.speak(utterance);
}

async function loadDemoDays() {
  if (state.demoInProgress) return;
  state.demoInProgress = true;
  const button = $("#load-demo-days");
  button.disabled = true;
  setArchiveMessage("Preparing original demo illustrations and music…");
  try {
    const existing = new Set((await getMemories()).map((record) => record.id));
    for (const record of await makeDemoDays()) if (!existing.has(record.id)) await putMemory(record);
    dom.archiveSearch.value = "";
    dom.archiveDateFilter.value = "";
    await loadArchive();
    setArchiveMessage("Three fictional demo days are available. Their artwork and music were created for DAYTONE; they are not personal photographs.");
  } catch (error) {
    setArchiveMessage(error.message || "Could not save demo days. Existing memories were not changed.", true);
    await loadArchive();
  } finally { button.disabled = false; state.demoInProgress = false; }
}
