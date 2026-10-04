// Extension-local IndexedDB, not website storage or a remote upload. Page data
// and its next cursor are committed in one transaction, never separate writes.
export function createReviewStore(factory = indexedDB) {
  let database;
  const open = () => database ||= new Promise((resolve, reject) => {
    const request = factory.open('taoa-review-progress-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'itemId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('storage_unavailable'));
    request.onblocked = () => reject(new Error('storage_unavailable'));
  });
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', mode), request = operation(tx.objectStore('jobs'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('storage_unavailable'));
    });
  }
  return { get: id => transaction('readonly', s => s.get(id)),
    list: () => transaction('readonly', s => s.getAll()),
    put: value => transaction('readwrite', s => s.put(value)) };
}
