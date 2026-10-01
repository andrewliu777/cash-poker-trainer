import { createFirebaseAppCheck } from "./firebaseAppCheck.js";

Deno.test("App Check activates before Auth and reuses the Firebase app and attestation", async () => {
	const events = [];
	let config;
	const instance = {
		activate: (provider, refresh) => { events.push(["activate", provider.key, refresh]); },
		getToken: async () => ({ token: "attestation" }),
	};
	const sdk = {
		apps: [],
		initializeApp: (options) => {
			config = options;
			events.push(["initialize"]);
			return { appCheck: () => instance, auth: () => events.push(["auth"]) };
		},
		appCheck: { ReCaptchaEnterpriseProvider: class { constructor(key) { this.key = key; } } },
	};
	const verification = createFirebaseAppCheck({ sdk, hostname: "cash-poker-trainer.web.app", siteKey: "public-site-key" });
	verification.getApp().auth();
	const token = await verification.getToken();
	verification.getApp();
	if (JSON.stringify(events) !== JSON.stringify([["initialize"], ["activate", "public-site-key", true], ["auth"]]) ||
		token !== "attestation" || config.authDomain !== "cash-poker-trainer.web.app" || !config.appId) {
		throw new Error("App Check initialization order or same-origin Google auth configuration is incorrect");
	}
});

Deno.test("empty configuration needs no SDK and configured attestation fails closed", async () => {
	if (await createFirebaseAppCheck({ sdk: null, siteKey: "" }).getToken() !== null) {
		throw new Error("Unconfigured App Check changed the local-only behavior");
	}
	let failed = false;
	try {
		await createFirebaseAppCheck({ sdk: null, siteKey: "public-site-key" }).getToken();
	} catch (error) {
		failed = error.code === "APP_CHECK_UNAVAILABLE";
	}
	if (!failed) {
		throw new Error("Configured App Check silently allowed an unattested request");
	}
});

Deno.test("production never reads the local debug credential", async () => {
	const previous = globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
	let debugReads = 0;
	const sdk = {
		apps: [],
		initializeApp: () => ({ appCheck: () => ({ activate: () => {} }) }),
		appCheck: { ReCaptchaEnterpriseProvider: class {} },
	};
	try {
		createFirebaseAppCheck({ sdk, hostname: "cash-poker-trainer.web.app", siteKey: "public-site-key",
			debugStorage: { getItem: () => { debugReads++; return "private-debug-token"; } } }).getApp();
		if (debugReads || globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN !== previous) {
			throw new Error("Production enabled a local debug credential");
		}
	} finally {
		if (previous === undefined) {
			delete globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
		} else {
			globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = previous;
		}
	}
});
