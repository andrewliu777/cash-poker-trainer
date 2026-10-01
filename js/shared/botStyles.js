export const CASH_BOT_STYLE_VERSION = 1;

export const CASH_BOT_STYLE_IDS = [
	"balanced",
	"tight-value",
	"loose-passive",
	"pressure",
];

const STYLE_PROFILES = {
	balanced: {
		openThresholdOffset: 0,
		raiseThresholdOffset: 0,
		callBarrierOffset: 0,
		raiseAmountFactor: 1,
		bluffFactor: 1,
	},
	"tight-value": {
		openThresholdOffset: 0.85,
		raiseThresholdOffset: 0.55,
		callBarrierOffset: 0.06,
		raiseAmountFactor: 1.15,
		bluffFactor: 0.35,
	},
	"loose-passive": {
		openThresholdOffset: -0.25,
		raiseThresholdOffset: 0.85,
		callBarrierOffset: -0.08,
		raiseAmountFactor: 0.85,
		bluffFactor: 0.25,
	},
	pressure: {
		openThresholdOffset: -0.75,
		raiseThresholdOffset: -0.60,
		callBarrierOffset: 0.02,
		raiseAmountFactor: 1.20,
		bluffFactor: 1.50,
	},
};

export function getCashBotStyle(styleId) {
	return STYLE_PROFILES[styleId] ?? STYLE_PROFILES.balanced;
}

export function drawCashBotStyles(count, random = Math.random) {
	const styles = [];
	while (styles.length < count) {
		const shuffled = CASH_BOT_STYLE_IDS.slice();
		for (let index = shuffled.length - 1; index > 0; index--) {
			const swapIndex = Math.floor(random() * (index + 1));
			[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
		}
		styles.push(...shuffled.slice(0, count - styles.length));
	}
	return styles;
}
