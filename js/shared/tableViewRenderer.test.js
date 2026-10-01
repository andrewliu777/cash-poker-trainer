import { getLivePlayerActionState } from "./syncViewModel.js";
import {
	getActionLabelBadgeText,
	renderSeatActionLabel,
} from "./tableViewRenderer.js";

function assertEquals(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

Deno.test("cash action badges keep the action and amount until cleared", () => {
	const actionState = {
		name: "call",
		amount: 25,
		streetTotalTo: 45,
		persistent: true,
	};
	assertEquals(getLivePlayerActionState(actionState, Date.now() + 60000), actionState);
	assertEquals(getActionLabelBadgeText("call", 25), "Call 25");
	assertEquals(getActionLabelBadgeText("raise", 45, 100), "Raise to 100");

	const classes = new Set();
	const target = {
		seatEl: {
			classList: {
				add: (value) => classes.add(value),
				remove: (value) => classes.delete(value),
			},
		},
		nameEl: { textContent: "Bot 1" },
		actionLabelTimer: null,
	};
	renderSeatActionLabel(target, { playerName: "Bot 1", actionName: actionState.name, ...actionState });
	assertEquals(target.nameEl.textContent, "Call 25");
	assertEquals(classes.has("action-label"), true);
	assertEquals(target.actionLabelTimer, null);
	renderSeatActionLabel(target, { playerName: "Bot 1" });
	assertEquals(target.nameEl.textContent, "Bot 1");
	assertEquals(classes.has("action-label"), false);
});
