import { replayHandHistory } from "./handHistory.js";
import { getPositionLabels } from "./handText.js";

const DIMENSION_ORDER = ["Mode", "Position", "Starting depth"];
const MODE_ORDER = ["Free table", "Similar samples"];
const POSITION_ORDER = ["BTN/SB", "BTN", "SB", "BB", "UTG", "HJ", "CO"];
const DEPTH_ORDER = ["<40 BB", "40–99 BB", "100+ BB"];

function summarizeHeroHand(history) {
	const hero = history.seats.find((seat) => !seat.isBot);
	if (!hero || history.events.at(-1)?.type !== "hand.ended") {
		return null;
	}
	const state = replayHandHistory(history);
	const ending = state.stacks.find((seat) => seat.seatIndex === hero.seatIndex);
	const startingDepth = hero.startingChips / history.bigBlind;
	const position = getPositionLabels(history).get(hero.seatIndex);
	let preflopMax = 0;
	let hadOpportunity = false;
	let vpip = false;
	let pfr = false;
	for (const event of history.events) {
		if (event.type === "board.dealt") {
			break;
		}
		if (event.type === "blind.posted") {
			preflopMax = Math.max(preflopMax, event.data.streetTotalTo);
		} else if (event.type === "action.applied" && event.data.street === "preflop") {
			const action = event.data;
			if (action.seatIndex === hero.seatIndex) {
				hadOpportunity = true;
				vpip ||= action.paid > 0;
				pfr ||= action.kind === "raise" ||
					(action.kind === "allin" && action.streetTotalTo > preflopMax);
			}
			preflopMax = Math.max(preflopMax, action.streetTotalTo);
		}
	}
	return {
		mode: history.practice ? "Similar samples" : "Free table",
		position,
		depth: startingDepth < 40 ? DEPTH_ORDER[0] :
			startingDepth < 100 ? DEPTH_ORDER[1] : DEPTH_ORDER[2],
		netBB: (ending.chips - hero.startingChips) / history.bigBlind,
		hadOpportunity,
		vpip,
		pfr,
	};
}

export function summarizeHeroHandGroups(histories) {
	const groups = new Map();
	for (const history of histories) {
		const hand = summarizeHeroHand(history);
		if (!hand) {
			continue;
		}
		for (const [dimension, group] of [
			["Mode", "All hands"],
			["Position", hand.position],
			["Starting depth", hand.depth],
		]) {
			const key = `${dimension}:${hand.mode}:${group}`;
			if (!groups.has(key)) {
				groups.set(key, {
					dimension, mode: hand.mode, group, hands: 0, netBB: 0,
					vpip: { count: 0, opportunities: 0 },
					pfr: { count: 0, opportunities: 0 },
				});
			}
			const row = groups.get(key);
			row.hands++;
			row.netBB += hand.netBB;
			row.vpip.opportunities += Number(hand.hadOpportunity);
			row.pfr.opportunities += Number(hand.hadOpportunity);
			row.vpip.count += Number(hand.vpip);
			row.pfr.count += Number(hand.pfr);
		}
	}
	return Array.from(groups.values()).sort((a, b) =>
		DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension) ||
		MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
		(a.dimension === "Position"
			? POSITION_ORDER.indexOf(a.group) - POSITION_ORDER.indexOf(b.group)
			: a.dimension === "Starting depth"
				? DEPTH_ORDER.indexOf(a.group) - DEPTH_ORDER.indexOf(b.group) : 0)
	);
}
