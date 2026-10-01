import { projectSeatHandHistory, replayHandHistory } from "./handHistory.js";

const SUITS = { C: "♣", D: "♦", H: "♥", S: "♠" };

export function createHistorySessionId(now = new Date(), uniqueId = globalThis.crypto.randomUUID()) {
	const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
	return `${stamp}Z-${uniqueId}`;
}

export function formatHistorySessionLabel(sessionId, current = false) {
	const stamp = sessionId.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})Z-/);
	const date = stamp ? new Date(`${stamp[1]}:${stamp[2]}:${stamp[3]}Z`) : null;
	const label = date && !Number.isNaN(date.getTime())
		? date.toLocaleString()
		: `Session ${sessionId.slice(0, 8)}`;
	return current ? `Current · ${label}` : label;
}

function cardLabel(card) {
	return card ? `${card[0]}${SUITS[card[1]]}` : "??";
}

function eventLabel(event, seatNames) {
	const data = event.data;
	const name = seatNames.get(data.seatIndex) ?? "Player";
	switch (event.type) {
		case "blind.posted":
			return `${name} posts ${data.blind === "small" ? "SB" : "BB"} ${data.paid}`;
		case "board.dealt":
			return `${data.run === 2 ? "Run 2 · " : ""}${data.street[0].toUpperCase()}${data.street.slice(1)}: ${data.cards.map(cardLabel).join(" ")}`;
		case "runout.chosen":
			return "Run it twice";
		case "action.applied":
			if (data.kind === "raise") {
				return `${name} raises to ${data.streetTotalTo}`;
			}
			if (data.kind === "allin") {
				return `${name} goes all-in for ${data.paid} (to ${data.streetTotalTo})`;
			}
			return `${name} ${data.kind}${data.paid > 0 ? `s ${data.paid}` : "s"}`;
		case "hole.revealed":
			return `${name} reveals ${data.cards.map(cardLabel).join(" ")}`;
		case "uncalled.returned":
			return `${name} receives uncalled ${data.amount}`;
		case "pot.settled":
			return data.payouts.map((payout) =>
				`${seatNames.get(payout.seatIndex)} wins ${payout.amount}`
			).join(" · ");
		case "hand.ended":
			return "Hand complete";
		default:
			throw new RangeError("Unknown hand event");
	}
}

function seatActionLabel(event) {
	if (event?.type === "blind.posted") {
		return `${event.data.blind === "small" ? "SB" : "BB"} ${event.data.paid}`;
	}
	if (event?.type === "action.applied") {
		const { kind, paid, streetTotalTo } = event.data;
		if (kind === "raise") return `RAISE TO ${streetTotalTo}`;
		if (kind === "allin") return "ALL-IN";
		return `${kind.toUpperCase()}${paid ? ` ${paid}` : ""}`;
	}
	if (event?.type === "hole.revealed") return "SHOW";
	if (event?.type === "uncalled.returned") return `RETURN ${event.data.amount}`;
	return null;
}

export function buildHandReviewIndex(histories, currentSessionId = null) {
	const sessions = new Map();
	for (const history of histories) {
		if (!sessions.has(history.sessionId)) {
			sessions.set(history.sessionId, { sessionId: history.sessionId, hands: [] });
		}
		sessions.get(history.sessionId).hands.push({
			key: `${history.sessionId}:${history.handId}`,
			handId: history.handId,
		});
	}
	return Array.from(sessions.values()).map((session) => ({
		...session,
		hands: session.hands.sort((a, b) => b.handId - a.handId),
	})).sort((a, b) =>
		Number(b.sessionId === currentSessionId) - Number(a.sessionId === currentSessionId) ||
		b.sessionId.localeCompare(a.sessionId)
	);
}

export function getHeroHandNet(history) {
	const hero = history.seats.find((seat) => !seat.isBot);
	const finalEvent = history.events.at(-1);
	if (!hero || finalEvent?.type !== "hand.ended") {
		return null;
	}
	const ending = finalEvent.data.endingStacks.find((seat) => seat.seatIndex === hero.seatIndex);
	return ending ? ending.chips - hero.startingChips : null;
}

export function buildHandReplaySteps(history) {
	return [0, ...history.events.filter((event) => event.type !== "hole.dealt").map((event) => event.seq)];
}

export function getReplaySeatPositions(seats) {
	const slots = {
		2: [0, 3],
		3: [0, 2, 4],
		4: [0, 1, 3, 5],
		5: [0, 1, 2, 4, 5],
		6: [0, 1, 2, 3, 4, 5],
	}[seats.length];
	if (!slots) {
		throw new RangeError("Replay supports two to six seats");
	}
	const heroIndex = seats.findIndex((seat) => seat.isHero);
	const anchorIndex = heroIndex >= 0 ? heroIndex : Math.max(0,
		seats.findIndex((seat) => seat.isDealer));
	return new Map(seats.map((seat, index) => [
		seat.seatIndex, slots[(index - anchorIndex + seats.length) % seats.length],
	]));
}

export function buildHandReplayFrame(history, throughSeq) {
	const heroSeatIndex = history.seats.find((seat) => !seat.isBot)?.seatIndex ?? null;
	const visible = projectSeatHandHistory(history, heroSeatIndex);
	if (!replayHandHistory(visible).ended) {
		throw new RangeError("Only completed hands can be replayed");
	}
	const state = replayHandHistory(visible, throughSeq);
	const seatNames = new Map(visible.seats.map((seat) => [seat.seatIndex, seat.name]));
	const stacks = new Map(state.stacks.map((entry) => [entry.seatIndex, entry.chips]));
	const bets = new Map(state.streetBets.map((entry) => [entry.seatIndex, entry.amount]));
	const dealt = new Map(state.holeCards.map((entry) => [entry.seatIndex, entry.cards]));
	const heroCards = visible.events.find((event) =>
		event.type === "hole.dealt" && event.data.seatIndex === heroSeatIndex
	)?.data.cards;
	const revealed = new Map(state.revealedCards.map((entry) => [entry.seatIndex, entry.cards]));
	const folded = new Set(state.foldedSeatIndexes);
	const events = visible.events.slice(0, throughSeq)
		.filter((event) => event.type !== "hole.dealt").map((event) => ({
			seq: event.seq,
			label: eventLabel(event, seatNames),
		}));
	const currentRecord = visible.events[throughSeq - 1];
	return {
		seq: throughSeq,
		maxSeq: visible.events.length,
		street: state.street,
		board: state.board.slice(),
		secondBoard: state.secondBoard?.slice() ?? null,
		pot: state.pot,
		ended: state.ended,
		currentEvent: events.at(-1)?.label ?? "Before blinds",
		activeSeatIndex: ["blind.posted", "action.applied", "hole.revealed", "uncalled.returned"]
			.includes(currentRecord?.type) ? currentRecord.data.seatIndex : null,
		activeAction: seatActionLabel(currentRecord),
		events,
		seats: visible.seats.map((seat) => {
			const ownCards = seat.seatIndex === heroSeatIndex
				? dealt.get(seat.seatIndex) ?? heroCards : null;
			const shownCards = ownCards ?? revealed.get(seat.seatIndex) ?? [];
			return {
				seatIndex: seat.seatIndex,
				name: seat.name,
				isHero: seat.seatIndex === heroSeatIndex,
				isDealer: seat.seatIndex === visible.dealerSeatIndex,
				stack: stacks.get(seat.seatIndex),
				streetBet: state.settled ? 0 : bets.get(seat.seatIndex),
				folded: folded.has(seat.seatIndex),
				cards: shownCards.concat(Array(Math.max(0, 2 - shownCards.length)).fill(null)),
			};
		}),
	};
}
