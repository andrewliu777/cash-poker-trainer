export const HAND_HISTORY_SCHEMA_VERSION = 1;

const CARD_PATTERN = /^[2-9TJQKA][CDHS]$/;
const EVENT_TYPES = new Set([
	"blind.posted",
	"hole.dealt",
	"board.dealt",
	"runout.chosen",
	"action.applied",
	"hole.revealed",
	"uncalled.returned",
	"pot.settled",
	"hand.ended",
]);
const PRACTICE_KEYS = ["mode", "source", "filters", "sampleId", "sampleOrdinal", "resetIndex"];
const PRACTICE_SOURCE_KEYS = ["handKey", "decisionSeq", "decisionId"];
const PRACTICE_FILTER_KEYS = ["smallBlind", "bigBlind", "chipUnit", "dealerSeatIndex",
	"heroSeatIndex", "seats", "priorFoldSeatIndexes", "pot", "heroToCall"];
const PRACTICE_FILTER_SEAT_KEYS = ["seatIndex", "name", "isBot", "botStyle",
	"botStyleVersion", "startingChips"];

function freezeValue(value) {
	if (value && typeof value === "object") {
		Object.values(value).forEach(freezeValue);
		Object.freeze(value);
	}
	return value;
}

function copyValue(value) {
	return structuredClone(value);
}

function isChipAmount(value, chipUnit) {
	return Number.isSafeInteger(value) && value >= 0 && value % chipUnit === 0;
}

function hasExactKeys(value, keys) {
	return value && typeof value === "object" && !Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isValidPracticeFilters(filters) {
	if (!hasExactKeys(filters, PRACTICE_FILTER_KEYS) ||
		!Number.isSafeInteger(filters.chipUnit) || filters.chipUnit < 1 ||
		!isChipAmount(filters.smallBlind, filters.chipUnit) || filters.smallBlind < 1 ||
		!isChipAmount(filters.bigBlind, filters.chipUnit) ||
		filters.bigBlind <= filters.smallBlind ||
		!Array.isArray(filters.seats) || filters.seats.length < 2 || filters.seats.length > 6 ||
		!Number.isSafeInteger(filters.dealerSeatIndex) ||
		!Number.isSafeInteger(filters.heroSeatIndex) ||
		filters.pot !== filters.smallBlind + filters.bigBlind ||
		!isChipAmount(filters.heroToCall, filters.chipUnit) ||
		filters.heroToCall > filters.bigBlind ||
		!Array.isArray(filters.priorFoldSeatIndexes)) {
		return false;
	}
	const seats = filters.seats;
	return seats.every((seat, index) =>
		hasExactKeys(seat, PRACTICE_FILTER_SEAT_KEYS) && seat.seatIndex === index &&
		(typeof seat.name === "string" && seat.name.length > 0) &&
		typeof seat.isBot === "boolean" &&
		(seat.botStyle === null || typeof seat.botStyle === "string") &&
		(seat.botStyleVersion === null || Number.isSafeInteger(seat.botStyleVersion)) &&
		isChipAmount(seat.startingChips, filters.chipUnit) && seat.startingChips > 0
	) && seats.some((seat) => seat.seatIndex === filters.dealerSeatIndex) &&
		seats.filter((seat) => !seat.isBot).length === 1 &&
		seats[filters.heroSeatIndex]?.isBot === false &&
		filters.priorFoldSeatIndexes.length < seats.length &&
		new Set(filters.priorFoldSeatIndexes).size === filters.priorFoldSeatIndexes.length &&
		filters.priorFoldSeatIndexes.every((seatIndex) =>
			Number.isSafeInteger(seatIndex) && seats[seatIndex]?.isBot === true
		);
}

function isValidPractice(practice) {
	const hasDeckSeed = Object.prototype.hasOwnProperty.call(practice ?? {}, "deckSeed");
	return (hasExactKeys(practice, PRACTICE_KEYS) ||
		hasExactKeys(practice, [...PRACTICE_KEYS, "deckSeed"])) &&
		practice.mode === "similar_sample" &&
		hasExactKeys(practice.source, PRACTICE_SOURCE_KEYS) &&
		typeof practice.source.handKey === "string" && practice.source.handKey.length > 0 &&
		Number.isSafeInteger(practice.source.decisionSeq) && practice.source.decisionSeq > 0 &&
		Number.isSafeInteger(practice.source.decisionId) && practice.source.decisionId > 0 &&
		isValidPracticeFilters(practice.filters) &&
		typeof practice.sampleId === "string" && practice.sampleId.length > 0 &&
		Number.isSafeInteger(practice.sampleOrdinal) && practice.sampleOrdinal > 0 &&
		Number.isSafeInteger(practice.resetIndex) && practice.resetIndex >= 0 &&
		(!hasDeckSeed || (Number.isInteger(practice.deckSeed) && practice.deckSeed >= 0 &&
			practice.deckSeed <= 0xFFFFFFFF));
}

function projectPractice(practice, includeDeckSeed = false) {
	const projected = {
		mode: practice.mode,
		source: {
			handKey: practice.source.handKey,
			decisionSeq: practice.source.decisionSeq,
			decisionId: practice.source.decisionId,
		},
		filters: {
			smallBlind: practice.filters.smallBlind,
			bigBlind: practice.filters.bigBlind,
			chipUnit: practice.filters.chipUnit,
			dealerSeatIndex: practice.filters.dealerSeatIndex,
			heroSeatIndex: practice.filters.heroSeatIndex,
			seats: practice.filters.seats.map((seat) => ({
				seatIndex: seat.seatIndex,
				name: seat.name,
				isBot: seat.isBot,
				botStyle: seat.botStyle,
				botStyleVersion: seat.botStyleVersion,
				startingChips: seat.startingChips,
			})),
			priorFoldSeatIndexes: practice.filters.priorFoldSeatIndexes.slice(),
			pot: practice.filters.pot,
			heroToCall: practice.filters.heroToCall,
		},
		sampleId: practice.sampleId,
		sampleOrdinal: practice.sampleOrdinal,
		resetIndex: practice.resetIndex,
		...(includeDeckSeed ? { deckSeed: practice.deckSeed } : {}),
	};
	if (!isValidPractice(projected)) {
		throw new RangeError("Invalid practice metadata");
	}
	return projected;
}

function isValidDecisionSeq(decisionSeq) {
	return decisionSeq == null ||
		(Number.isSafeInteger(decisionSeq) && decisionSeq > 0);
}

export function createHandHistory({
	sessionId,
	handId,
	dealerSeatIndex,
	smallBlind,
	bigBlind,
	chipUnit,
	players,
	appVersion = null,
	cashTransactionsBeforeHand = [],
	practice = null,
}) {
	if (
		typeof sessionId !== "string" || sessionId.length === 0 ||
		!Number.isSafeInteger(handId) || handId < 1 ||
		!Number.isSafeInteger(chipUnit) || chipUnit < 1 ||
		!isChipAmount(smallBlind, chipUnit) || !isChipAmount(bigBlind, chipUnit) ||
		smallBlind <= 0 || bigBlind <= smallBlind ||
		!Array.isArray(players) || players.length < 2 ||
		!players.some((player) => player.seatIndex === dealerSeatIndex)
	) {
		throw new RangeError("Invalid hand history header");
	}
	const seats = players.map((player) => ({
		seatIndex: player.seatIndex,
		name: player.name,
		isBot: player.isBot === true,
		botStyle: player.isBot === true ? player.botStyle ?? "balanced" : null,
		botStyleVersion: player.isBot === true ? player.botStyleVersion ?? null : null,
		startingChips: player.chips,
	}));
	if (
		new Set(seats.map((seat) => seat.seatIndex)).size !== seats.length ||
		seats.some((seat) => !Number.isSafeInteger(seat.seatIndex) ||
			!isChipAmount(seat.startingChips, chipUnit))
	) {
		throw new RangeError("Invalid hand history seats");
	}
	if (practice !== null && !isValidPractice(practice)) {
		throw new RangeError("Invalid practice metadata");
	}
	return freezeValue(copyValue({
		schemaVersion: HAND_HISTORY_SCHEMA_VERSION,
		sessionId,
		handId,
		gameMode: "cash",
		rake: 0,
		appVersion,
		dealerSeatIndex,
		smallBlind,
		bigBlind,
		chipUnit,
		seats,
		cashTransactionsBeforeHand,
		...(practice === null ? {} : { practice: projectPractice(practice, true) }),
		events: [],
	}));
}

export function appendHandEvent(history, type, data, visibility = { kind: "public" }) {
	if (!history || history.schemaVersion !== HAND_HISTORY_SCHEMA_VERSION ||
		!EVENT_TYPES.has(type) ||
		history.events.at(-1)?.type === "hand.ended" ||
		(visibility.kind !== "public" &&
			!(visibility.kind === "seat" && Number.isSafeInteger(visibility.seatIndex)))) {
		throw new RangeError("Invalid hand history event");
	}
	if (type === "hole.dealt" &&
		(visibility.kind !== "seat" || visibility.seatIndex !== data.seatIndex)) {
		throw new RangeError("Hole cards must be seat private");
	}
	const event = copyValue({
		seq: history.events.length + 1,
		type,
		visibility,
		data,
	});
	return freezeValue({
		...history,
		events: [...history.events, event],
	});
}

export function projectSeatHandHistory(history, seatIndex) {
	const projectEventData = (event) => {
		const data = event.data;
		switch (event.type) {
			case "blind.posted":
				return {
					seatIndex: data.seatIndex, blind: data.blind, paid: data.paid,
					streetTotalTo: data.streetTotalTo, potAfter: data.potAfter,
				};
			case "hole.dealt":
				return {
					seatIndex: data.seatIndex,
					cards: data.seatIndex === seatIndex ? data.cards.slice() : [null, null],
				};
			case "board.dealt":
				return { street: data.street, cards: data.cards.slice(),
					...(data.run === 2 ? { run: 2 } : {}) };
			case "runout.chosen":
				return { count: data.count, sharedCards: data.sharedCards.slice() };
			case "action.applied":
				return {
					seatIndex: data.seatIndex, decisionId: data.decisionId, street: data.street,
					kind: data.kind, paid: data.paid, streetTotalTo: data.streetTotalTo,
					potAfter: data.potAfter, allIn: data.allIn,
				};
			case "hole.revealed":
				return { seatIndex: data.seatIndex, cards: data.cards.slice() };
			case "uncalled.returned":
				return { seatIndex: data.seatIndex, amount: data.amount, potAfter: data.potAfter };
			case "pot.settled":
				return {
					totalPot: data.totalPot,
					hadShowdown: data.hadShowdown,
					payouts: data.payouts.map((payout) => ({
						seatIndex: payout.seatIndex,
						amount: payout.amount,
					})),
					potResults: (data.potResults ?? []).map((result) => ({
						players: result.players.slice(),
						amount: result.amount,
						hand: result.hand,
						isRefundOnly: result.isRefundOnly,
						...(result.run ? { run: result.run } : {}),
					})),
					...(data.runoutBoards ? { runoutBoards: data.runoutBoards.map((board) => board.slice()) } : {}),
				};
			case "hand.ended":
				return {
					endingStacks: data.endingStacks.map((entry) => ({
						seatIndex: entry.seatIndex,
						chips: entry.chips,
					})),
				};
			default:
				throw new RangeError("Unknown hand history event");
		}
	};
	return {
		schemaVersion: history.schemaVersion,
		sessionId: history.sessionId,
		handId: history.handId,
		gameMode: history.gameMode,
		rake: history.rake,
		appVersion: history.appVersion,
		dealerSeatIndex: history.dealerSeatIndex,
		smallBlind: history.smallBlind,
		bigBlind: history.bigBlind,
		chipUnit: history.chipUnit,
		...(Object.prototype.hasOwnProperty.call(history, "practice")
			? { practice: projectPractice(history.practice) } : {}),
		seats: history.seats.map((seat) => ({
			seatIndex: seat.seatIndex,
			name: seat.name,
			isBot: seat.isBot,
			botStyle: seat.botStyle ?? null,
			botStyleVersion: seat.botStyleVersion ?? null,
			startingChips: seat.startingChips,
		})),
		cashTransactionsBeforeHand: history.cashTransactionsBeforeHand.map((transaction) => ({
			type: transaction.type,
			seatIndex: transaction.seatIndex,
			amount: transaction.amount,
			handId: transaction.handId,
		})),
		events: history.events.map((event) => ({
			seq: event.seq,
			type: event.type,
			visibility: event.type === "hole.dealt"
				? { kind: "seat", seatIndex: event.data.seatIndex }
				: { kind: "public" },
			data: projectEventData(event),
		})),
	};
}

export function exportSeatHandHistories(histories, annotations = []) {
	const keys = new Set(histories.map((history) => `${history.sessionId}:${history.handId}`));
	return JSON.stringify({
		schemaVersion: HAND_HISTORY_SCHEMA_VERSION,
		exportKind: "seat",
		hands: histories.map((history) => {
			const seatIndex = history.seats.find((seat) => seat.isBot !== true)?.seatIndex ?? null;
			return {
				seatIndex,
				history: projectSeatHandHistory(history, seatIndex),
			};
		}),
		annotations: annotations.filter((annotation) => keys.has(annotation.key)).map((annotation) => ({
			key: annotation.key,
			tag: annotation.tag,
			note: annotation.note,
			...(annotation.decisionSeq == null ? {} : { decisionSeq: annotation.decisionSeq }),
		})),
	}, null, 2);
}

export function parseSeatHandHistories(text) {
	return parseSeatHandBackup(text).histories;
}

export function parseSeatHandBackup(text) {
	if (typeof text !== "string" || text.length > 25_000_000) {
		throw new RangeError("Invalid hand history file size");
	}
	const file = JSON.parse(text);
	if (file?.schemaVersion !== HAND_HISTORY_SCHEMA_VERSION ||
		file.exportKind !== "seat" || !Array.isArray(file.hands) ||
		file.hands.length > 10_000) {
		throw new RangeError("Unsupported hand history file");
	}
	const keys = new Set();
	const histories = file.hands.map(({ seatIndex, history }) => {
		if (!history || !history.seats?.some((seat) => seat.seatIndex === seatIndex && !seat.isBot) &&
			seatIndex !== null) {
			throw new RangeError("Invalid export seat");
		}
		const key = `${history.sessionId}:${history.handId}`;
		if (keys.has(key) || !replayHandHistory(history).ended ||
			(history.practice && Object.prototype.hasOwnProperty.call(history.practice, "deckSeed")) ||
			history.events.some((event) => event.type === "hole.dealt" &&
				event.data.seatIndex !== seatIndex && event.data.cards.some((card) => card !== null))) {
			throw new RangeError("Invalid exported hand");
		}
		keys.add(key);
		return projectSeatHandHistory(history, seatIndex);
	});
	const rawAnnotations = file.annotations ?? [];
	if (!Array.isArray(rawAnnotations) || rawAnnotations.length > keys.size) {
		throw new RangeError("Invalid hand annotations");
	}
	const annotationKeys = new Set();
	const annotations = rawAnnotations.map((annotation) => {
		if (!annotation || typeof annotation.key !== "string" ||
			!keys.has(annotation.key) || annotationKeys.has(annotation.key) ||
			!["", "yellow", "red", "green"].includes(annotation.tag) ||
			typeof annotation.note !== "string" || annotation.note.length > 2000 ||
			!isValidDecisionSeq(annotation.decisionSeq)) {
			throw new RangeError("Invalid hand annotation");
		}
		annotationKeys.add(annotation.key);
		return {
			key: annotation.key, tag: annotation.tag, note: annotation.note,
			...(annotation.decisionSeq == null ? {} : { decisionSeq: annotation.decisionSeq }),
		};
	});
	return { histories, annotations };
}

export function replayHandHistory(history, throughSeq = history?.events?.length) {
	if (!history || history.schemaVersion !== HAND_HISTORY_SCHEMA_VERSION ||
		history.gameMode !== "cash" || !Array.isArray(history.events) ||
		!Array.isArray(history.seats) || history.seats.length < 2 ||
		!Number.isSafeInteger(history.chipUnit) || history.chipUnit < 1 ||
		typeof history.sessionId !== "string" || history.sessionId.length === 0 ||
		!Number.isSafeInteger(history.handId) || history.handId < 1 ||
		!isChipAmount(history.smallBlind, history.chipUnit) || history.smallBlind <= 0 ||
		!isChipAmount(history.bigBlind, history.chipUnit) || history.bigBlind <= history.smallBlind ||
		history.rake !== 0 ||
		!history.seats.some((seat) => seat.seatIndex === history.dealerSeatIndex) ||
		!Array.isArray(history.cashTransactionsBeforeHand)) {
		throw new RangeError("Invalid hand history");
	}
	if (Object.prototype.hasOwnProperty.call(history, "practice") &&
		!isValidPractice(history.practice)) {
		throw new RangeError("Invalid practice metadata");
	}
	if (!Number.isSafeInteger(throughSeq) || throughSeq < 0 || throughSeq > history.events.length) {
		throw new RangeError("Invalid replay sequence");
	}
	if (history.cashTransactionsBeforeHand.some((transaction) =>
		!Number.isSafeInteger(transaction.seatIndex) ||
		!isChipAmount(transaction.amount, history.chipUnit) ||
		!["buy_in", "manual_top_up", "auto_top_up"].includes(transaction.type) ||
		!Number.isSafeInteger(transaction.handId)
	)) {
		throw new RangeError("Invalid cash transaction");
	}
	const stacks = new Map();
	const streetBets = new Map();
	const totalPaid = new Map();
	const holeCards = new Map();
	const revealedCards = new Map();
	const usedCards = new Set();
	const foldedSeats = new Set();
	for (const seat of history.seats) {
		if (!Number.isSafeInteger(seat.seatIndex) || stacks.has(seat.seatIndex) ||
			!isChipAmount(seat.startingChips, history.chipUnit)) {
			throw new RangeError("Invalid hand history seat");
		}
		stacks.set(seat.seatIndex, seat.startingChips);
		streetBets.set(seat.seatIndex, 0);
		totalPaid.set(seat.seatIndex, 0);
		revealedCards.set(seat.seatIndex, new Set());
	}
	let pot = 0;
	let street = "preflop";
	let board = [];
	let secondBoard = null;
	let secondStreet = "preflop";
	let settled = false;
	let ended = false;
	let refundReturned = false;
	let blindCount = 0;
	let smallBlindSeatIndex = null;
	const seenDecisions = new Set();
	for (const [index, event] of history.events.slice(0, throughSeq).entries()) {
		if (event.seq !== index + 1 || !EVENT_TYPES.has(event.type) || ended) {
			throw new RangeError("Invalid hand history sequence");
		}
		if (event.type !== "hole.dealt" && event.visibility?.kind !== "public") {
			throw new RangeError("Invalid event visibility");
		}
		const data = event.data;
		const seatIndex = data.seatIndex;
		if (event.type === "blind.posted" || event.type === "action.applied") {
			if (settled || !stacks.has(seatIndex) || !isChipAmount(data.paid, history.chipUnit) ||
				data.paid > stacks.get(seatIndex) || !isChipAmount(data.streetTotalTo, history.chipUnit) ||
				data.streetTotalTo !== streetBets.get(seatIndex) + data.paid ||
				data.potAfter !== pot + data.paid) {
				throw new RangeError("Invalid hand history payment");
			}
			if (event.type === "blind.posted") {
				const expectedBlind = blindCount === 0 ? "small" : "big";
				const blindLimit = blindCount === 0 ? history.smallBlind : history.bigBlind;
				if (street !== "preflop" || blindCount > 1 || data.blind !== expectedBlind ||
					data.paid <= 0 || data.paid > blindLimit ||
					(blindCount === 1 && seatIndex === smallBlindSeatIndex)) {
					throw new RangeError("Invalid blind event");
				}
				if (blindCount === 0) {
					smallBlindSeatIndex = seatIndex;
				}
				blindCount++;
			} else {
				if (secondBoard !== null || data.street !== street ||
					blindCount !== 2 || holeCards.size !== stacks.size ||
					foldedSeats.has(seatIndex) || stacks.get(seatIndex) === 0 ||
					!["fold", "check", "call", "raise", "allin"].includes(data.kind) ||
					!Number.isSafeInteger(data.decisionId) || seenDecisions.has(data.decisionId) ||
					(["fold", "check"].includes(data.kind) && data.paid !== 0) ||
					data.allIn !== (stacks.get(seatIndex) === data.paid)) {
					throw new RangeError("Invalid action event");
				}
				seenDecisions.add(data.decisionId);
				if (data.kind === "fold") {
					foldedSeats.add(seatIndex);
				}
			}
			stacks.set(seatIndex, stacks.get(seatIndex) - data.paid);
			streetBets.set(seatIndex, data.streetTotalTo);
			totalPaid.set(seatIndex, totalPaid.get(seatIndex) + data.paid);
			pot = data.potAfter;
		} else if (event.type === "hole.dealt") {
			if (settled || event.visibility?.kind !== "seat" ||
				event.visibility.seatIndex !== seatIndex || !stacks.has(seatIndex) ||
				blindCount !== 2 || holeCards.has(seatIndex) || seenDecisions.size > 0 || board.length > 0 ||
				!Array.isArray(data.cards) || data.cards.length !== 2) {
				throw new RangeError("Invalid hole card event");
			}
			for (const card of data.cards) {
				if (card === null) {
					continue;
				}
				if (typeof card !== "string" || !CARD_PATTERN.test(card) || usedCards.has(card)) {
					throw new RangeError("Duplicate or invalid card");
				}
				usedCards.add(card);
			}
			holeCards.set(seatIndex, data.cards.slice());
		} else if (event.type === "runout.chosen") {
			const liveSeats = Array.from(stacks.keys()).filter((currentSeatIndex) =>
				!foldedSeats.has(currentSeatIndex));
			const actionableSeats = liveSeats.filter((currentSeatIndex) =>
				stacks.get(currentSeatIndex) > 0);
			const currentBet = Math.max(...streetBets.values());
			if (settled || secondBoard !== null || data.count !== 2 ||
				blindCount !== 2 || holeCards.size !== stacks.size ||
				board.length >= 5 || !Array.isArray(data.sharedCards) ||
				JSON.stringify(data.sharedCards) !== JSON.stringify(board) ||
				liveSeats.length < 2 || actionableSeats.length > 1 ||
				(actionableSeats.length === 1 && streetBets.get(actionableSeats[0]) !== currentBet)) {
				throw new RangeError("Invalid runout choice");
			}
			secondBoard = board.slice();
			secondStreet = street;
		} else if (event.type === "board.dealt") {
			const isSecond = data.run === 2;
			const currentStreet = isSecond ? secondStreet : street;
			const expected = currentStreet === "preflop" ? ["flop", 3] :
				currentStreet === "flop" ? ["turn", 1] : currentStreet === "turn" ? ["river", 1] : null;
			if (settled || !expected || holeCards.size !== stacks.size ||
				(isSecond ? secondBoard === null || board.length !== 5 : data.run !== undefined && data.run !== 1) ||
				data.street !== expected[0] || !Array.isArray(data.cards) ||
				data.cards.length !== expected[1]) {
				throw new RangeError("Invalid board event");
			}
			for (const card of data.cards) {
				if (typeof card !== "string" || !CARD_PATTERN.test(card) || usedCards.has(card)) {
					throw new RangeError("Duplicate or invalid card");
				}
				usedCards.add(card);
			}
			if (isSecond) {
				secondBoard = secondBoard.concat(data.cards);
				secondStreet = data.street;
			} else {
				board = board.concat(data.cards);
				street = data.street;
				for (const currentSeatIndex of streetBets.keys()) {
					streetBets.set(currentSeatIndex, 0);
				}
			}
		} else if (event.type === "hole.revealed") {
			if (!stacks.has(seatIndex) || !holeCards.has(seatIndex) ||
				!Array.isArray(data.cards) || data.cards.length < 1 || data.cards.length > 2) {
				throw new RangeError("Invalid reveal event");
			}
			for (const card of data.cards) {
				if (!CARD_PATTERN.test(card) || revealedCards.get(seatIndex).has(card) ||
					(!holeCards.get(seatIndex).includes(card) && !holeCards.get(seatIndex).includes(null)) ||
					(!holeCards.get(seatIndex).includes(card) && usedCards.has(card))) {
					throw new RangeError("Invalid revealed card");
				}
				revealedCards.get(seatIndex).add(card);
				usedCards.add(card);
			}
		} else if (event.type === "uncalled.returned") {
			const largestContributions = Array.from(totalPaid.entries())
				.sort((a, b) => b[1] - a[1]);
			const expectedAmount = largestContributions[0][1] - largestContributions[1][1];
			if (settled || refundReturned || !stacks.has(seatIndex) ||
				!isChipAmount(data.amount, history.chipUnit) || data.amount <= 0 ||
				data.amount !== expectedAmount || seatIndex !== largestContributions[0][0] ||
				foldedSeats.has(seatIndex) || data.amount > pot ||
				data.potAfter !== pot - data.amount) {
				throw new RangeError("Invalid uncalled return");
			}
			stacks.set(seatIndex, stacks.get(seatIndex) + data.amount);
			pot = data.potAfter;
			refundReturned = true;
		} else if (event.type === "pot.settled") {
			const largestContributions = Array.from(totalPaid.entries())
				.sort((a, b) => b[1] - a[1]);
			const needsRefund = largestContributions[0][1] > largestContributions[1][1] &&
				!foldedSeats.has(largestContributions[0][0]);
			if (settled || blindCount !== 2 || holeCards.size !== stacks.size ||
				(secondBoard !== null && (board.length !== 5 || secondBoard.length !== 5 ||
					!Array.isArray(data.runoutBoards) || data.runoutBoards.length !== 2 ||
					JSON.stringify(data.runoutBoards) !== JSON.stringify([board, secondBoard]) ||
					!Array.isArray(data.potResults) ||
					data.potResults.reduce((sum, result) => sum + result.amount, 0) !== pot)) ||
				(secondBoard === null && data.runoutBoards !== undefined) ||
				needsRefund !== refundReturned ||
				data.totalPot !== pot || !Array.isArray(data.payouts) ||
				data.payouts.reduce((total, payout) => total + payout.amount, 0) !== pot) {
				throw new RangeError("Invalid settlement");
			}
			const paidSeats = new Set();
			for (const payout of data.payouts) {
				if (!stacks.has(payout.seatIndex) || paidSeats.has(payout.seatIndex) ||
					!isChipAmount(payout.amount, history.chipUnit)) {
					throw new RangeError("Invalid payout");
				}
				paidSeats.add(payout.seatIndex);
				stacks.set(payout.seatIndex, stacks.get(payout.seatIndex) + payout.amount);
			}
			pot = 0;
			settled = true;
		} else if (event.type === "hand.ended") {
			if (!settled || pot !== 0 || !Array.isArray(data.endingStacks) ||
				data.endingStacks.length !== stacks.size ||
				new Set(data.endingStacks.map((entry) => entry.seatIndex)).size !== stacks.size ||
				holeCards.size !== stacks.size ||
				data.endingStacks.some((entry) => stacks.get(entry.seatIndex) !== entry.chips) ||
				Array.from(stacks.values()).reduce((sum, chips) => sum + chips, 0) !==
					 history.seats.reduce((sum, seat) => sum + seat.startingChips, 0)) {
				throw new RangeError("Invalid ending stacks");
			}
			ended = true;
		}
	}
	return {
		seq: throughSeq,
		street,
		board,
		secondBoard: secondBoard?.slice() ?? null,
		pot,
		stacks: Array.from(stacks, ([seatIndex, chips]) => ({ seatIndex, chips })),
		streetBets: Array.from(streetBets, ([seatIndex, amount]) => ({ seatIndex, amount })),
		contributions: Array.from(totalPaid, ([seatIndex, amount]) => ({ seatIndex, amount })),
		holeCards: Array.from(holeCards, ([seatIndex, cards]) => ({ seatIndex, cards: cards.slice() })),
		revealedCards: Array.from(revealedCards, ([seatIndex, cards]) => ({ seatIndex, cards: Array.from(cards) })),
		foldedSeatIndexes: Array.from(foldedSeats),
		settled,
		ended,
	};
}
