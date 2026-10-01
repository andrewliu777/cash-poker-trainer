import { getBettingRoundStartIndex, getBlindSeatIndexes } from "../gameEngine.js";
import { CASH_BOT_STYLE_IDS, CASH_BOT_STYLE_VERSION } from "../shared/botStyles.js";
import { replayHandHistory } from "../shared/handHistory.js";

export function shuffleWithSeed(array, seed) {
	if (!Array.isArray(array) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError("Invalid seeded shuffle input");
	}
	let state = seed >>> 0;
	for (let index = array.length - 1; index > 0; index--) {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		const swapIndex = Math.floor(random * (index + 1));
		[array[index], array[swapIndex]] = [array[swapIndex], array[index]];
	}
	return array;
}

export function deriveSimilarSpot(history, decisionSeq) {
	if (!Number.isSafeInteger(decisionSeq) || decisionSeq < 1 ||
		history?.gameMode !== "cash" || history.practice || history.chipUnit !== 1 ||
		!Array.isArray(history.seats) || history.seats.length < 2 || history.seats.length > 6) {
		return null;
	}

	let before;
	try {
		if (!replayHandHistory(history).ended) {
			return null;
		}
		before = replayHandHistory(history, decisionSeq - 1);
	} catch {
		return null;
	}

	const heroSeats = history.seats.filter((seat) => seat.isBot !== true);
	const hero = heroSeats[0];
	const action = history.events[decisionSeq - 1];
	if (heroSeats.length !== 1 || !action || action.type !== "action.applied" ||
		action.data.seatIndex !== hero.seatIndex || action.data.street !== "preflop" ||
		before.street !== "preflop" || before.board.length !== 0 || before.settled ||
		before.holeCards.length !== history.seats.length ||
		history.seats.some((seat) => seat.startingChips <= 0 ||
			(seat.isBot && (!CASH_BOT_STYLE_IDS.includes(seat.botStyle) ||
				seat.botStyleVersion !== CASH_BOT_STYLE_VERSION)))) {
		return null;
	}

	const heroCards = before.holeCards.find((entry) => entry.seatIndex === hero.seatIndex)?.cards;
	if (!heroCards || heroCards.length !== 2 || heroCards.some((card) => typeof card !== "string")) {
		return null;
	}

	const orderedSeats = history.seats.slice().sort((a, b) => a.seatIndex - b.seatIndex);
	if (orderedSeats.some((seat, index) => seat.seatIndex !== index)) {
		return null;
	}
	const dealerIndex = orderedSeats.findIndex((seat) => seat.seatIndex === history.dealerSeatIndex);
	if (dealerIndex === -1) {
		return null;
	}
	const dealerOrder = orderedSeats.slice(dealerIndex).concat(orderedSeats.slice(0, dealerIndex));
	const blindIndexes = getBlindSeatIndexes(dealerOrder.length);
	const blinds = history.events.filter((event) => event.type === "blind.posted");
	if (blinds.length !== 2 ||
		blinds[0].data.seatIndex !== dealerOrder[blindIndexes.smallBlindIndex].seatIndex ||
		blinds[0].data.paid !== history.smallBlind ||
		blinds[1].data.seatIndex !== dealerOrder[blindIndexes.bigBlindIndex].seatIndex ||
		blinds[1].data.paid !== history.bigBlind) {
		return null;
	}

	const prefix = history.events.slice(0, decisionSeq - 1);
	if (prefix.some((event) => !["blind.posted", "hole.dealt", "action.applied"].includes(event.type))) {
		return null;
	}
	const priorActions = prefix.filter((event) => event.type === "action.applied");
	if (priorActions.length >= dealerOrder.length - 1 || priorActions.some((event) =>
		event.data.street !== "preflop" || event.data.kind !== "fold" ||
		!history.seats.find((seat) => seat.seatIndex === event.data.seatIndex)?.isBot
	)) {
		return null;
	}

	const startIndex = getBettingRoundStartIndex(dealerOrder.map((seat, index) => ({
		seatIndex: seat.seatIndex,
		bigBlind: index === blindIndexes.bigBlindIndex,
	})), 0);
	for (let index = 0; index < priorActions.length; index++) {
		if (priorActions[index].data.seatIndex !==
			dealerOrder[(startIndex + index) % dealerOrder.length].seatIndex) {
			return null;
		}
	}
	if (action.data.seatIndex !==
		dealerOrder[(startIndex + priorActions.length) % dealerOrder.length].seatIndex) {
		return null;
	}

	const priorFoldSeatIndexes = priorActions.map((event) => event.data.seatIndex);
	const foldedSeats = new Set(before.foldedSeatIndexes);
	const stacks = new Map(before.stacks.map((entry) => [entry.seatIndex, entry.chips]));
	const streetBets = new Map(before.streetBets.map((entry) => [entry.seatIndex, entry.amount]));
	const smallBlindSeatIndex = dealerOrder[blindIndexes.smallBlindIndex].seatIndex;
	const bigBlindSeatIndex = dealerOrder[blindIndexes.bigBlindIndex].seatIndex;
	if (before.pot !== history.smallBlind + history.bigBlind ||
		foldedSeats.size !== priorFoldSeatIndexes.length ||
		priorFoldSeatIndexes.some((seatIndex) => !foldedSeats.has(seatIndex)) ||
		history.seats.some((seat) => {
			const blind = seat.seatIndex === smallBlindSeatIndex ? history.smallBlind :
				seat.seatIndex === bigBlindSeatIndex ? history.bigBlind : 0;
			return stacks.get(seat.seatIndex) !== seat.startingChips - blind ||
				streetBets.get(seat.seatIndex) !== blind;
		})) {
		return null;
	}

	return {
		mode: "similar_sample",
		source: {
			handKey: `${history.sessionId}:${history.handId}`,
			decisionSeq,
			decisionId: action.data.decisionId,
		},
		filters: {
			smallBlind: history.smallBlind,
			bigBlind: history.bigBlind,
			chipUnit: history.chipUnit,
			dealerSeatIndex: history.dealerSeatIndex,
			heroSeatIndex: hero.seatIndex,
			seats: orderedSeats.map((seat) => ({
				seatIndex: seat.seatIndex,
				name: seat.name,
				isBot: seat.isBot,
				botStyle: seat.botStyle,
				botStyleVersion: seat.botStyleVersion,
				startingChips: seat.startingChips,
			})),
			priorFoldSeatIndexes,
			pot: before.pot,
			heroToCall: Math.max(0, history.bigBlind - streetBets.get(hero.seatIndex)),
		},
	};
}
