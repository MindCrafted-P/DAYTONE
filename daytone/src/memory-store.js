const DATABASE_NAME = "daytone-diary";
const DATABASE_VERSION = 2;
const STORE_NAME = "memories";

let databasePromise;

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support local diary storage."));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("Could not open diary storage."));
      request.onblocked = () => reject(new Error("Diary storage is blocked by another tab."));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}

export async function getMemories() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Could not read memories."));
    transaction.onabort = () => reject(transaction.error || new Error("Reading memories was cancelled."));
  });
}

export async function putMemory(memory) {
  if (!Array.isArray(memory.photos) || !memory.photos.length
      || !memory.photos.every((photo) => photo?.blob instanceof Blob && photo.blob.size > 0)) {
    throw new Error("Add at least one photograph to keep this memory.");
  }
  const hasLocal = memory.audioBlob instanceof Blob && memory.audioBlob.size > 0;
  const hasYoutube = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(memory.sourceUrl || "");
  if (!(memory.sourceType === "local" && hasLocal && !memory.sourceUrl)
      && !(memory.sourceType === "youtube" && hasYoutube && memory.audioBlob == null)) {
    throw new Error("Choose one soundtrack: a local audio file or a valid YouTube link.");
  }
  if (!Number.isFinite(memory.startTime) || memory.startTime < 0
      || !Number.isFinite(memory.excerptDuration) || memory.excerptDuration <= 0
      || !Number.isFinite(memory.startTime + memory.excerptDuration)) {
    throw new Error("Choose a valid start and duration for the soundtrack excerpt.");
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const rejectSave = (error) => {
      reject(error?.name === "QuotaExceededError"
        ? new Error("This browser is out of storage space. Free up space, then try saving again.")
        : error || new Error("Could not save this memory."));
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(memory);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => rejectSave(transaction.error);
      transaction.onabort = () => rejectSave(transaction.error || new Error("Saving this memory was cancelled."));
    } catch (error) {
      rejectSave(error);
    }
  });
}

export async function deleteMemory(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not delete this memory."));
    transaction.onabort = () => reject(transaction.error || new Error("Deleting this memory was cancelled."));
  });
}
