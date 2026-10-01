import { replayHandHistory } from "../shared/handHistory.js";

const DATABASE_NAME = "poker-cash-training";
let activeDatabaseName = DATABASE_NAME;
const DATABASE_VERSION = 2;
const STORE_NAME = "hands";
const ANNOTATION_STORE_NAME = "hand-annotations";

function openHandDatabase(databaseName = activeDatabaseName) {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
			}
			if (!request.result.objectStoreNames.contains(ANNOTATION_STORE_NAME)) {
				request.result.createObjectStore(ANNOTATION_STORE_NAME, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export function setHandStoreAccount(uid) {
	if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
		throw new RangeError("Invalid account ID");
	}
	activeDatabaseName = `${DATABASE_NAME}-${uid}`;
}

export async function readLegacyHandData() {
	const database = await openHandDatabase(DATABASE_NAME);
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME, ANNOTATION_STORE_NAME], "readonly");
			const hands = transaction.objectStore(STORE_NAME).getAll();
			const notes = transaction.objectStore(ANNOTATION_STORE_NAME).getAll();
			transaction.oncomplete = () => resolve({
				histories: hands.result.map((entry) => entry.history),
				annotations: notes.result,
			});
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		database.close();
	}
}

export function getHandHistoryKey(history) {
	return `${history.sessionId}:${history.handId}`;
}

export async function saveHandHistory(history) {
	if (!replayHandHistory(history).ended) {
		throw new RangeError("Only completed hands can be stored");
	}
	const database = await openHandDatabase();
	try {
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put({
				key: getHandHistoryKey(history),
				history,
			});
			transaction.oncomplete = resolve;
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		database.close();
	}
}

export async function readAllHandHistories() {
	const database = await openHandDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readonly");
			const request = transaction.objectStore(STORE_NAME).getAll();
			request.onsuccess = () => resolve(request.result.map((entry) => entry.history));
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

export async function readHandAnnotation(key) {
	const database = await openHandDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(ANNOTATION_STORE_NAME, "readonly");
			const request = transaction.objectStore(ANNOTATION_STORE_NAME).get(key);
			request.onsuccess = () => resolve(request.result
				? { ...request.result, decisionSeq: request.result.decisionSeq ?? null }
				: { key, tag: "", note: "", decisionSeq: null });
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

export async function saveHandAnnotation(key, { tag = "", note = "", decisionSeq = null }) {
	if (typeof key !== "string" || !["", "yellow", "red", "green"].includes(tag) ||
		typeof note !== "string" || note.length > 2000 ||
		(decisionSeq !== null && (!Number.isSafeInteger(decisionSeq) || decisionSeq < 1))) {
		throw new RangeError("Invalid hand annotation");
	}
	const database = await openHandDatabase();
	try {
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(ANNOTATION_STORE_NAME, "readwrite");
			const store = transaction.objectStore(ANNOTATION_STORE_NAME);
			if (tag || note || decisionSeq !== null) {
				store.put({
					key, tag, note,
					...(decisionSeq === null ? {} : { decisionSeq }),
				});
			} else {
				store.delete(key);
			}
			transaction.oncomplete = resolve;
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		database.close();
	}
}

export async function readAllHandAnnotations() {
	const database = await openHandDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(ANNOTATION_STORE_NAME, "readonly");
			const request = transaction.objectStore(ANNOTATION_STORE_NAME).getAll();
			request.onsuccess = () => resolve(request.result.map((entry) => ({
				...entry,
				decisionSeq: entry.decisionSeq ?? null,
			})));
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
}

export async function importHandHistories(histories, annotations = []) {
	const keys = new Set();
	for (const history of histories) {
		const key = getHandHistoryKey(history);
		if (keys.has(key) || !replayHandHistory(history).ended) {
			throw new RangeError("Invalid imported hand");
		}
		keys.add(key);
	}
	const annotationKeys = new Set();
	for (const annotation of annotations) {
		if (!annotation || !keys.has(annotation.key) || annotationKeys.has(annotation.key) ||
			!["", "yellow", "red", "green"].includes(annotation.tag) ||
			typeof annotation.note !== "string" || annotation.note.length > 2000 ||
			(annotation.decisionSeq != null &&
				(!Number.isSafeInteger(annotation.decisionSeq) || annotation.decisionSeq < 1))) {
			throw new RangeError("Invalid imported hand annotation");
		}
		annotationKeys.add(annotation.key);
	}
	const database = await openHandDatabase();
	try {
		await new Promise((resolve, reject) => {
			const transaction = database.transaction([STORE_NAME, ANNOTATION_STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const annotationStore = transaction.objectStore(ANNOTATION_STORE_NAME);
			for (const history of histories) {
				const key = getHandHistoryKey(history);
				const request = store.get(key);
				request.onsuccess = () => {
					if (!request.result) {
						store.add({ key, history });
					}
				};
			}
			for (const annotation of annotations) {
				const request = annotationStore.get(annotation.key);
				request.onsuccess = () => {
					if (!request.result) {
						annotationStore.add({
							key: annotation.key, tag: annotation.tag, note: annotation.note,
							...(annotation.decisionSeq == null ? {} : { decisionSeq: annotation.decisionSeq }),
						});
					}
				};
			}
			transaction.oncomplete = resolve;
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		database.close();
	}
}
