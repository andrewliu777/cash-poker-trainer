import { exportSeatHandHistories, parseSeatHandBackup } from "../shared/handHistory.js";
import {
	getHandHistoryKey,
	importHandHistories,
	readAllHandAnnotations,
	readAllHandHistories,
	saveHandAnnotation,
} from "./handStore.js";

function documentId(key) {
	const bytes = new TextEncoder().encode(key);
	if (bytes.length > 1000) {
		throw new RangeError("Hand key is too long to sync");
	}
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return `h_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function cloudSessionDocumentPath(uid, sessionKey) {
	return `users/${encodeURIComponent(uid)}/state/${documentId(sessionKey)}`;
}

function fieldValue(document) {
	const value = document?.fields?.payload?.stringValue;
	if (typeof value !== "string") {
		throw new RangeError("Invalid cloud record");
	}
	return value;
}

async function listAll(client, path) {
	const documents = [];
	let next = "";
	do {
		const page = await client.listDocuments(path, next);
		documents.push(...(page?.documents ?? []));
		next = page?.nextPageToken ?? "";
	} while (next);
	return documents;
}

function isEmptyAnnotation(annotation) {
	return !annotation || (!annotation.tag && !annotation.note && annotation.decisionSeq == null);
}

function annotationValue(annotation) {
	return JSON.stringify({
		tag: annotation?.tag ?? "",
		note: annotation?.note ?? "",
		decisionSeq: annotation?.decisionSeq ?? null,
	});
}

export function createCloudSync(client, storage, uid, sessionKey) {
	const path = `users/${encodeURIComponent(uid)}`;
	const sessionDocumentPath = cloudSessionDocumentPath(uid, sessionKey);
	const metaKey = `poker:cloud-sync:v1:${uid}`;
	let meta;
	try {
		meta = JSON.parse(storage.getItem(metaKey) ?? "null") ?? { annotations: {}, sessions: {} };
	} catch {
		meta = { annotations: {}, sessions: {} };
	}
	if (!meta.annotations || typeof meta.annotations !== "object") {
		meta.annotations = {};
	}
	if (!meta.sessions || typeof meta.sessions !== "object") {
		meta.sessions = {};
	}
	let inFlight = null;

	function saveMeta() {
		storage.setItem(metaKey, JSON.stringify(meta));
	}

	async function syncHands() {
		const collection = `${path}/hands`;
		const remote = await listAll(client, collection);
		const remoteById = new Map(remote.map((document) => [document.name.split("/").at(-1), document]));
		const local = await readAllHandHistories();
		for (const history of local) {
			const id = documentId(getHandHistoryKey(history));
			const payload = exportSeatHandHistories([history]);
			if (remoteById.has(id)) {
				if (fieldValue(remoteById.get(id)) !== payload) {
					throw new Error("A hand with the same ID differs between this device and the cloud.");
				}
			} else {
				try {
					await client.createDocument(collection, id, { payload: { stringValue: payload } });
				} catch (error) {
					if (error.status !== 409) {
						throw error;
					}
				}
			}
		}
		const localKeys = new Set(local.map(getHandHistoryKey));
		for (const document of remote) {
			const { histories } = parseSeatHandBackup(fieldValue(document));
			if (histories.length !== 1 || documentId(getHandHistoryKey(histories[0])) !== document.name.split("/").at(-1)) {
				throw new RangeError("Invalid cloud hand identity");
			}
			if (!localKeys.has(getHandHistoryKey(histories[0]))) {
				await importHandHistories(histories);
			}
		}
	}

	async function syncAnnotations() {
		const collection = `${path}/annotations`;
		const remote = await listAll(client, collection);
		const remoteById = new Map(remote.map((document) => [document.name.split("/").at(-1), document]));
		const local = new Map((await readAllHandAnnotations()).map((annotation) => [annotation.key, annotation]));
		const keys = new Set([...local.keys(), ...Object.keys(meta.annotations)]);
		for (const document of remote) {
			const value = JSON.parse(fieldValue(document));
			if (typeof value.key !== "string" || documentId(value.key) !== document.name.split("/").at(-1)) {
				throw new RangeError("Invalid cloud annotation identity");
			}
			keys.add(value.key);
		}
		for (const key of keys) {
			const id = documentId(key);
			const document = remoteById.get(id);
			const cloudValue = document ? JSON.parse(fieldValue(document)) : null;
			const localValue = local.get(key);
			const localJson = annotationValue(localValue);
			const cloudJson = annotationValue(cloudValue);
			const base = meta.annotations[key];
			if (!document) {
				if (!isEmptyAnnotation(localValue)) {
					await client.createDocument(collection, id, {
						payload: { stringValue: JSON.stringify({ key, ...JSON.parse(localJson) }) },
					});
				}
				meta.annotations[key] = localJson;
				saveMeta();
				continue;
			}
			if (localJson === cloudJson) {
				meta.annotations[key] = localJson;
				saveMeta();
				continue;
			}
			if (base === undefined && !isEmptyAnnotation(localValue)) {
				throw new Error("A hand note differs between this device and the cloud. Export a backup before resolving it.");
			}
			if (base === undefined || localJson === base) {
				await saveHandAnnotation(key, cloudValue);
				meta.annotations[key] = cloudJson;
				saveMeta();
				continue;
			}
			if (cloudJson === base) {
				await client.patchDocument(`${collection}/${id}`, {
					payload: { stringValue: JSON.stringify({ key, ...JSON.parse(localJson) }) },
				}, document.updateTime);
				meta.annotations[key] = localJson;
				saveMeta();
				continue;
			}
			throw new Error("Hand note changed on two devices. Export a backup before resolving it.");
		}
		saveMeta();
	}

	async function syncSession() {
		const documentPath = sessionDocumentPath;
		const remote = await client.getDocument(documentPath);
		const cloudValue = remote ? fieldValue(remote) : "null";
		const localValue = storage.getItem(sessionKey) ?? "null";
		const base = meta.sessions[sessionKey] ?? null;
		if (!remote) {
			if (localValue !== "null") {
				await client.createDocument(`${path}/state`, sessionDocumentPath.split("/").at(-1), {
					payload: { stringValue: localValue },
				});
			}
			meta.sessions[sessionKey] = localValue;
			return false;
		}
		if (localValue === cloudValue) {
			meta.sessions[sessionKey] = localValue;
			return false;
		}
		if ((base === null && localValue === "null") || localValue === base) {
			if (cloudValue === "null") {
				storage.removeItem(sessionKey);
			} else {
				JSON.parse(cloudValue);
				storage.setItem(sessionKey, cloudValue);
			}
			meta.sessions[sessionKey] = cloudValue;
			return true;
		}
		if (cloudValue === base) {
			await client.patchDocument(documentPath, {
				payload: { stringValue: localValue },
			}, remote.updateTime);
			meta.sessions[sessionKey] = localValue;
			return false;
		}
		throw new Error("The session changed on two devices. Finish or export one copy before syncing again.");
	}

	function sync(full = true) {
		if (inFlight && full) {
			return inFlight.then(() => sync(true));
		}
		if (!inFlight) {
			inFlight = (async () => {
				if (full) {
					await syncHands();
					await syncAnnotations();
				}
				const sessionChanged = await syncSession();
				saveMeta();
				return { sessionChanged };
			})().finally(() => { inFlight = null; });
		}
		return inFlight;
	}

	async function resolveSession(useCloud) {
		const documentPath = sessionDocumentPath;
		const remote = await client.getDocument(documentPath);
		const cloudValue = remote ? fieldValue(remote) : "null";
		if (useCloud) {
			if (cloudValue === "null") {
				storage.removeItem(sessionKey);
			} else {
				JSON.parse(cloudValue);
				storage.setItem(sessionKey, cloudValue);
			}
			meta.sessions[sessionKey] = cloudValue;
		} else {
			const localValue = storage.getItem(sessionKey) ?? "null";
			if (remote) {
				await client.patchDocument(documentPath, {
					payload: { stringValue: localValue },
				}, remote.updateTime);
			} else if (localValue !== "null") {
				await client.createDocument(`${path}/state`, sessionDocumentPath.split("/").at(-1), {
					payload: { stringValue: localValue },
				});
			}
			meta.sessions[sessionKey] = localValue;
		}
		saveMeta();
	}

	return { sync, resolveSession };
}
