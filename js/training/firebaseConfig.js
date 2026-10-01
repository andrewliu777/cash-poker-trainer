// Firebase project settings are public web configuration, not service-account credentials.
// Replace both placeholders after creating a Spark project.
export const FIREBASE_PROJECT_ID = "cash-poker-trainer";
export const FIREBASE_WEB_API_KEY = "AIzaSyCD2lkr3zHDwq-iKSvAtJei_0863jNWV1k";

export const FIREBASE_CONFIGURED =
	FIREBASE_PROJECT_ID.length > 0 && FIREBASE_WEB_API_KEY.length > 0 &&
	!FIREBASE_PROJECT_ID.startsWith("YOUR_") && !FIREBASE_WEB_API_KEY.startsWith("YOUR_");
