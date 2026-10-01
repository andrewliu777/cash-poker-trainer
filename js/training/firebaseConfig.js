// Firebase project settings are public web configuration, not service-account credentials.
// Keep these values in sync with the registered Firebase Web app.
export const FIREBASE_PROJECT_ID = "cash-poker-trainer";
export const FIREBASE_WEB_APP_ID = "1:907367234060:web:6929d6fd61bff2f6f64c29";
// Public score-based reCAPTCHA Enterprise site key, restricted to the two production domains.
export const FIREBASE_APP_CHECK_SITE_KEY = "6Ld2MdktAAAAACQVJWe2Qi0jf1gUyP4i0TIB9KAk";
export const FIREBASE_WEB_API_KEY = "AIzaSyCD2lkr3zHDwq-iKSvAtJei_0863jNWV1k";

export const FIREBASE_CONFIGURED =
	FIREBASE_PROJECT_ID.length > 0 && FIREBASE_WEB_API_KEY.length > 0 &&
	!FIREBASE_PROJECT_ID.startsWith("YOUR_") && !FIREBASE_WEB_API_KEY.startsWith("YOUR_");
