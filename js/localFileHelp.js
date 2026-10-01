if (globalThis.location.protocol === "file:") {
	document.addEventListener("DOMContentLoaded", () => {
		if (!globalThis.poker) {
			document.querySelector("#local-file-help").classList.remove("hidden");
		}
	}, { once: true });
}
