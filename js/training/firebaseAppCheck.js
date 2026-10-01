import {
	FIREBASE_APP_CHECK_SITE_KEY,
	FIREBASE_PROJECT_ID,
	FIREBASE_WEB_API_KEY,
	FIREBASE_WEB_APP_ID,
} from "./firebaseConfig.js";

export function createFirebaseAppCheck({
	sdk = globalThis.firebase,
	hostname = globalThis.location?.hostname,
	siteKey = FIREBASE_APP_CHECK_SITE_KEY,
	debugStorage = globalThis.sessionStorage,
} = {}) {
	let app = null;
	let appCheck = null;

	function getApp() {
		if (!sdk?.initializeApp) {
			throw new Error("Firebase could not load. Check your connection and try again.");
		}
		if (!app) {
			app = sdk.apps.length ? sdk.app() : sdk.initializeApp({
				apiKey: FIREBASE_WEB_API_KEY,
				authDomain: hostname === `${FIREBASE_PROJECT_ID}.web.app` ? hostname :
					`${FIREBASE_PROJECT_ID}.firebaseapp.com`,
				projectId: FIREBASE_PROJECT_ID,
				appId: FIREBASE_WEB_APP_ID,
			});
		}
		if (siteKey && !appCheck) {
			if (!sdk.appCheck?.ReCaptchaEnterpriseProvider) {
				throw new Error("App verification could not load. Check your connection and reload.");
			}
			if (hostname === "localhost" || hostname === "127.0.0.1") {
				// Debug credentials stay on the developer's device, never in the published configuration.
				const debugToken = debugStorage?.getItem("poker:app-check-debug-token:v1");
				if (debugToken) {
					globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
				}
			}
			const instance = app.appCheck();
			instance.activate(new sdk.appCheck.ReCaptchaEnterpriseProvider(siteKey), true);
			appCheck = instance;
		}
		return app;
	}

	return {
		getApp,
		async getToken() {
			if (!siteKey) {
				return null;
			}
			try {
				getApp();
				const result = await appCheck.getToken();
				if (!result?.token) {
					throw new Error("Missing app verification token");
				}
				return result.token;
			} catch {
				const error = new Error("App verification failed. Check your connection and reload before syncing.");
				error.code = "APP_CHECK_UNAVAILABLE";
				throw error;
			}
		},
	};
}
