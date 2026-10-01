import { FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY } from "./firebaseConfig.js";

const AUTH_STORAGE_KEY = "poker:firebase-auth:v1";
const GOOGLE_REDIRECT_KEY = "poker:google-redirect-pending:v1";
const AUTH_BASE = "https://identitytoolkit.googleapis.com/v1/accounts:";
const REFRESH_BASE = "https://securetoken.googleapis.com/v1/token";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function makeHttpError(status, body) {
	const error = new Error(body?.error?.message ?? `Cloud request failed (${status})`);
	error.status = status;
	error.code = body?.error?.status ?? body?.error?.message ?? "HTTP_ERROR";
	return error;
}

async function readResponse(response) {
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw makeHttpError(response.status, body);
	}
	return body;
}

function storeSession(storage, session) {
	storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
	return session;
}

function readSession(storage) {
	try {
		const session = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) ?? "null");
		return typeof session?.uid === "string" && session.uid.length > 0 &&
			typeof session?.refreshToken === "string" && session.refreshToken.length > 0 &&
			typeof session?.idToken === "string" && session.idToken.length > 0 ? session : null;
	} catch {
		return null;
	}
}

export function createFirebaseClient({ fetchImpl = fetch, storage = localStorage } = {}) {
	let session = readSession(storage);
	let googleAuth = null;

	function getGoogleAuth() {
		if (!globalThis.firebase?.auth) {
			throw new Error("Google sign-in could not load. Check your connection and try again.");
		}
		if (!googleAuth) {
			const app = globalThis.firebase.apps.length ? globalThis.firebase.app() :
				globalThis.firebase.initializeApp({
					apiKey: FIREBASE_WEB_API_KEY,
					authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
					projectId: FIREBASE_PROJECT_ID,
				});
			googleAuth = app.auth();
		}
		return googleAuth;
	}

	async function authRequest(method, data) {
		const response = await fetchImpl(`${AUTH_BASE}${method}?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
			cache: "no-store",
		});
		return readResponse(response);
	}

	function acceptAuthResponse(data, verified = false) {
		session = storeSession(storage, {
			uid: data.localId,
			email: data.email,
			idToken: data.idToken,
			refreshToken: data.refreshToken,
			expiresAt: Date.now() + Number(data.expiresIn) * 1000,
			verified,
		});
		return session;
	}

	async function refresh() {
		if (!session?.refreshToken) {
			throw new Error("Sign in required");
		}
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: session.refreshToken,
		});
		const response = await fetchImpl(`${REFRESH_BASE}?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			cache: "no-store",
		});
		const data = await readResponse(response);
		if (data.user_id !== session.uid) {
			throw new Error("Account identity changed");
		}
		session = storeSession(storage, {
			...session,
			idToken: data.id_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + Number(data.expires_in) * 1000,
		});
		return session;
	}

	async function getValidToken() {
		if (!session) {
			throw new Error("Sign in required");
		}
		if (Date.now() + 60_000 >= session.expiresAt) {
			await refresh();
		}
		return session.idToken;
	}

	async function lookup() {
		const data = await authRequest("lookup", { idToken: await getValidToken() });
		const user = data.users?.[0];
		if (!user || user.localId !== session.uid) {
			throw new Error("Account identity changed");
		}
		session = storeSession(storage, {
			...session,
			email: user.email,
			verified: user.emailVerified === true,
		});
		return session;
	}

	async function acceptGoogleUser(user) {
		try {
			if (!user?.uid || !user.refreshToken) {
				throw new Error("Google did not return a usable account. Please try again.");
			}
			acceptAuthResponse({
				localId: user.uid,
				email: user.email,
				idToken: await user.getIdToken(),
				refreshToken: user.refreshToken,
				expiresIn: "3600",
			});
			return await lookup();
		} finally {
			await getGoogleAuth().signOut().catch((error) => {
				console.warn("Google SDK sign-out failed", error);
			});
		}
	}

	async function firestoreRequest(path, options = {}) {
		const token = await getValidToken();
		const response = await fetchImpl(`${FIRESTORE_BASE}/${path}`, {
			...options,
			headers: {
				"Authorization": `Bearer ${token}`,
				...(options.body ? { "Content-Type": "application/json" } : {}),
			},
			cache: "no-store",
		});
		if (response.status === 404 && (!options.method || options.method === "GET")) {
			return null;
		}
		return readResponse(response);
	}

	return {
		get session() { return session; },
		async signUp(email, password) {
			return acceptAuthResponse(await authRequest("signUp", { email, password, returnSecureToken: true }));
		},
		async signIn(email, password) {
			acceptAuthResponse(await authRequest("signInWithPassword", {
				email, password, returnSecureToken: true,
			}));
			return lookup();
		},
		async signInWithGoogle() {
			const auth = getGoogleAuth();
			const provider = new globalThis.firebase.auth.GoogleAuthProvider();
			if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) &&
				globalThis.location.hostname === `${FIREBASE_PROJECT_ID}.firebaseapp.com`) {
				sessionStorage.setItem(GOOGLE_REDIRECT_KEY, "1");
				try {
					await auth.signInWithRedirect(provider);
				} catch (error) {
					sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
					throw error;
				}
				return null;
			}
			const result = await auth.signInWithPopup(provider);
			return acceptGoogleUser(result.user);
		},
		async restoreGoogleRedirect() {
			if (sessionStorage.getItem(GOOGLE_REDIRECT_KEY) !== "1") {
				return null;
			}
			try {
				const result = await getGoogleAuth().getRedirectResult();
				if (!result?.user) {
					throw new Error("Google sign-in was not completed. Please try again.");
				}
				return await acceptGoogleUser(result.user);
			} finally {
				sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
			}
		},
		async sendVerification() {
			return authRequest("sendOobCode", { requestType: "VERIFY_EMAIL", idToken: await getValidToken() });
		},
		async sendPasswordReset(email) {
			return authRequest("sendOobCode", { requestType: "PASSWORD_RESET", email });
		},
		async refreshVerification() {
			await refresh();
			return lookup();
		},
		async restore() {
			if (!session) {
				return null;
			}
			try {
				await refresh();
				return await lookup();
			} catch (error) {
				if (error instanceof TypeError && session?.verified) {
					return { ...session, offline: true };
				}
				storage.removeItem(AUTH_STORAGE_KEY);
				session = null;
				return null;
			}
		},
		signOut() {
			storage.removeItem(AUTH_STORAGE_KEY);
			session = null;
		},
		getValidToken,
		getDocument(path) {
			return firestoreRequest(path);
		},
		listDocuments(path, pageToken = "") {
			const query = new URLSearchParams({ pageSize: "100" });
			if (pageToken) {
				query.set("pageToken", pageToken);
			}
			return firestoreRequest(`${path}?${query}`);
		},
		createDocument(path, id, fields) {
			return firestoreRequest(`${path}?documentId=${encodeURIComponent(id)}`, {
				method: "POST",
				body: JSON.stringify({ fields }),
			});
		},
		patchDocument(path, fields, updateTime) {
			const query = new URLSearchParams({ "currentDocument.updateTime": updateTime });
			return firestoreRequest(`${path}?${query}`, {
				method: "PATCH",
				body: JSON.stringify({ fields }),
			});
		},
	};
}
