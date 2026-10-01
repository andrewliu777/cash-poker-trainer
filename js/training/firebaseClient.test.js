import { createFirebaseClient as createClient } from "./firebaseClient.js";

import { createFirebaseAppCheck } from "./firebaseAppCheck.js";

function createFirebaseClient(options) {
	return createClient({ appVerification: createFirebaseAppCheck({ siteKey: "" }), ...options });
}

function memoryStorage(initial = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => { data.set(key, value); },
		removeItem: (key) => { data.delete(key); },
	};
}

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

Deno.test("verified sign-in uses the ID token for owner-scoped Firestore reads", async () => {
	const calls = [];
	const storage = memoryStorage();
	const client = createFirebaseClient({ storage, fetchImpl: async (url, options) => {
		calls.push({ url, options });
		if (url.includes("signInWithPassword")) {
			return jsonResponse({ localId: "user-1", email: "a@example.com", idToken: "id-1",
				refreshToken: "refresh-1", expiresIn: "3600" });
		}
		if (url.includes("accounts:lookup")) {
			return jsonResponse({ users: [{ localId: "user-1", email: "a@example.com", emailVerified: true }] });
		}
		return jsonResponse({ fields: { payload: { stringValue: "test" } } });
	} });
	const session = await client.signIn("a@example.com", "password");
	if (!session.verified || session.uid !== "user-1") {
		throw new Error("Verified account identity was not retained");
	}
	const document = await client.getDocument("users/user-1/state/current");
	if (document.fields.payload.stringValue !== "test" ||
		calls[2].options.headers.Authorization !== "Bearer id-1" ||
		!calls[2].url.includes("/users/user-1/state/current")) {
		throw new Error("Firestore request did not use the account ID token and path");
	}
});

Deno.test("Google sign-in joins the existing verified account and uses its Firebase token", async () => {
	const previousFirebase = globalThis.firebase;
	const calls = [];
	let sdkSignedOut = false;
	const auth = {
		signInWithPopup: async () => ({ user: {
			uid: "google-user", email: "google@example.com", refreshToken: "google-refresh",
			getIdToken: async () => "google-id",
		} }),
		signOut: async () => { sdkSignedOut = true; },
	};
	const firebaseAuth = () => auth;
	firebaseAuth.GoogleAuthProvider = class {};
	globalThis.firebase = {
		apps: [],
		initializeApp: () => ({ auth: firebaseAuth }),
		auth: firebaseAuth,
	};
	try {
		const client = createFirebaseClient({ storage: memoryStorage(), fetchImpl: async (url, options) => {
			calls.push({ url, options });
			if (url.includes("accounts:lookup")) {
				return jsonResponse({ users: [{ localId: "google-user", email: "google@example.com",
					emailVerified: true }] });
			}
			return jsonResponse({ fields: {} });
		} });
		const session = await client.signInWithGoogle();
		await client.getDocument("users/google-user/state/current");
		if (!session.verified || session.uid !== "google-user" || !sdkSignedOut ||
			calls[1].options.headers.Authorization !== "Bearer google-id") {
			throw new Error("Google account was not bridged to the verified Firestore session");
		}
	} finally {
		globalThis.firebase = previousFirebase;
	}
});

Deno.test("Google redirect restores its account and clears the pending marker", async () => {
	const previousFirebase = globalThis.firebase;
	const previousSessionStorage = globalThis.sessionStorage;
	const redirectStorage = memoryStorage({ "poker:google-redirect-pending:v1": "1" });
	const auth = {
		getRedirectResult: async () => ({ user: {
			uid: "mobile-user", email: "mobile@example.com", refreshToken: "mobile-refresh",
			getIdToken: async () => "mobile-id",
		} }),
		signOut: async () => {},
	};
	const firebaseAuth = () => auth;
	globalThis.firebase = { apps: [], initializeApp: () => ({ auth: firebaseAuth }), auth: firebaseAuth };
	globalThis.sessionStorage = redirectStorage;
	try {
		const client = createFirebaseClient({ storage: memoryStorage(), fetchImpl: async () =>
			jsonResponse({ users: [{ localId: "mobile-user", email: "mobile@example.com", emailVerified: true }] }) });
		const session = await client.restoreGoogleRedirect();
		if (session.uid !== "mobile-user" || !session.verified ||
			redirectStorage.getItem("poker:google-redirect-pending:v1") !== null) {
			throw new Error("Google redirect result was not restored cleanly");
		}
	} finally {
		globalThis.firebase = previousFirebase;
		globalThis.sessionStorage = previousSessionStorage;
	}
});

Deno.test("mobile web.app Google redirect uses its own Hosting auth handler", async () => {
	const previousFirebase = globalThis.firebase;
	const previousSessionStorage = globalThis.sessionStorage;
	const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
	const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	let config;
	let redirected = false;
	const auth = { signInWithRedirect: async () => { redirected = true; } };
	const firebaseAuth = () => auth;
	firebaseAuth.GoogleAuthProvider = class {};
	globalThis.firebase = {
		apps: [],
		initializeApp: (options) => { config = options; return { auth: firebaseAuth }; },
		auth: firebaseAuth,
	};
	globalThis.sessionStorage = memoryStorage();
	Object.defineProperty(globalThis, "location", {
		configurable: true, value: { hostname: "cash-poker-trainer.web.app" },
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true, value: { userAgent: "Mozilla/5.0 (iPhone) CriOS/129.0" },
	});
	try {
		const client = createFirebaseClient({ storage: memoryStorage() });
		if (await client.signInWithGoogle() !== null || !redirected ||
			config.authDomain !== "cash-poker-trainer.web.app") {
			throw new Error("Mobile web.app sign-in did not use the same-origin redirect handler");
		}
	} finally {
		globalThis.firebase = previousFirebase;
		globalThis.sessionStorage = previousSessionStorage;
		if (previousLocation) {
			Object.defineProperty(globalThis, "location", previousLocation);
		} else {
			delete globalThis.location;
		}
		if (previousNavigator) {
			Object.defineProperty(globalThis, "navigator", previousNavigator);
		} else {
			delete globalThis.navigator;
		}
	}
});

Deno.test("offline restore keeps only a previously verified account", async () => {
	const session = { uid: "user-1", email: "a@example.com", idToken: "id-1", refreshToken: "refresh-1",
		expiresAt: Date.now() + 1000, verified: true };
	const storage = memoryStorage({ "poker:firebase-auth:v1": JSON.stringify(session) });
	const client = createFirebaseClient({ storage, fetchImpl: async () => { throw new TypeError("Offline"); } });
	const restored = await client.restore();
	if (restored?.uid !== "user-1" || restored.offline !== true) {
		throw new Error("Verified offline account was not restored");
	}
	const unverifiedStorage = memoryStorage({ "poker:firebase-auth:v1": JSON.stringify({ ...session, verified: false }) });
	const unverifiedClient = createFirebaseClient({ storage: unverifiedStorage,
		fetchImpl: async () => { throw new TypeError("Offline"); } });
	if (await unverifiedClient.restore() !== null || unverifiedStorage.getItem("poker:firebase-auth:v1")) {
		throw new Error("Unverified account was allowed to restore offline");
	}
});

Deno.test("missing Firestore reads and missing writes have different outcomes", async () => {
	const session = { uid: "user-1", email: "a@example.com", idToken: "id-1", refreshToken: "refresh-1",
		expiresAt: Date.now() + 3600000, verified: true };
	const client = createFirebaseClient({
		storage: memoryStorage({ "poker:firebase-auth:v1": JSON.stringify(session) }),
		fetchImpl: async () => jsonResponse({ error: { message: "NOT_FOUND" } }, 404),
	});
	if (await client.getDocument("users/user-1/state/current") !== null) {
		throw new Error("Missing document read did not return null");
	}
	let writeFailed = false;
	try {
		await client.patchDocument("users/user-1/state/current", { payload: { stringValue: "x" } }, "time");
	} catch (error) {
		writeFailed = error.status === 404;
	}
	if (!writeFailed) {
		throw new Error("Missing document write was silently accepted");
	}
});

Deno.test("App Check accompanies authentication, refresh, and Firestore requests", async () => {
	const calls = [];
	const client = createFirebaseClient({
		storage: memoryStorage(),
		appVerification: { getToken: async () => "app-check-token" },
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			if (url.includes("accounts:signUp")) {
				return jsonResponse({ localId: "user-1", email: "a@example.com", idToken: "id-1",
					refreshToken: "refresh-1", expiresIn: "0" });
			}
			if (url.includes("securetoken")) {
				return jsonResponse({ user_id: "user-1", id_token: "id-2", refresh_token: "refresh-2",
					expires_in: "3600" });
			}
			return jsonResponse({});
		},
	});
	await client.signUp("a@example.com", "password");
	await client.sendPasswordReset("a@example.com");
	await client.getDocument("users/user-1/state/current");
	await client.patchDocument("users/user-1/state/current", { payload: { stringValue: "test" } }, "time");
	if (calls.length !== 5 || calls.some(({ options }) =>
		options.headers["X-Firebase-AppCheck"] !== "app-check-token") ||
		calls[3].options.headers.Authorization !== "Bearer id-2") {
		throw new Error("An authenticated, refresh, or reset request lost App Check or account identity");
	}
});

Deno.test("failed app verification sends no cloud request and preserves verified offline data", async () => {
	let calls = 0;
	const session = { uid: "user-1", idToken: "id-1", refreshToken: "refresh-1", verified: true };
	const storage = memoryStorage({ "poker:firebase-auth:v1": JSON.stringify(session) });
	const client = createFirebaseClient({
		storage,
		appVerification: { getToken: async () => {
			const error = new Error("Attestation failed");
			error.code = "APP_CHECK_UNAVAILABLE";
			throw error;
		} },
		fetchImpl: async () => { calls++; return jsonResponse({}); },
	});
	let failed = false;
	try {
		await client.sendPasswordReset("a@example.com");
	} catch (error) {
		failed = error.code === "APP_CHECK_UNAVAILABLE";
	}
	const restored = await client.restore();
	if (!failed || calls !== 0 || !restored?.offline || !storage.getItem("poker:firebase-auth:v1")) {
		throw new Error("Failed app verification allowed a request or discarded the local verified account");
	}
});
