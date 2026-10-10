const DB_NAME = 'drawio-slide-workspace';
let dbPromise;
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readDraft() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('drafts').objectStore('drafts').get('latest');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeDraft(value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put({ ...value, updatedAt: Date.now() }, 'latest');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
