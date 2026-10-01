import { getPlayerActionState } from "./actionModel.js";

function projectPlayer(player) {
	return {
		name: player.name,
		seatIndex: player.seatIndex,
		chips: player.chips,
		roundBet: player.roundBet,
		totalBet: player.totalBet,
		folded: player.folded,
		allIn: player.allIn,
		dealer: player.dealer,
		smallBlind: player.smallBlind,
		bigBlind: player.bigBlind,
		stats: {
			hands: player.stats.hands,
			handsWon: player.stats.handsWon,
			vpip: player.stats.vpip,
			pfr: player.stats.pfr,
			calls: player.stats.calls,
			aggressiveActs: player.stats.aggressiveActs,
			reveals: player.stats.reveals,
			showdowns: player.stats.showdowns,
			showdownsWon: player.stats.showdownsWon,
			folds: player.stats.folds,
			foldsPreflop: player.stats.foldsPreflop,
			foldsPostflop: player.stats.foldsPostflop,
			allins: player.stats.allins,
		},
		spotState: {
			actedThisStreet: player.spotState.actedThisStreet,
			voluntaryThisStreet: player.spotState.voluntaryThisStreet,
			aggressiveThisStreet: player.spotState.aggressiveThisStreet,
			enteredPreflop: player.spotState.enteredPreflop,
		},
	};
}

export function projectSeatObservation(gameState, seatIndex) {
	const player = gameState.players.find((currentPlayer) => currentPlayer.seatIndex === seatIndex);
	if (!player) {
		throw new RangeError("Seat is not in this hand");
	}
	const actionState = getPlayerActionState(gameState, player);
	const handContext = gameState.handContext;
	return {
		schemaVersion: 1,
		gameMode: gameState.gameMode === "cash" ? "cash" : "tournament",
		handId: gameState.handId,
		decisionId: gameState.pendingSeatDecision?.seatIndex === seatIndex
			? gameState.pendingSeatDecision.decisionId
			: gameState.nextDecisionId ?? 1,
		seatIndex,
		botStyle: player.botStyle ?? "balanced",
		blindLevel: gameState.blindLevel,
		currentPhaseIndex: gameState.currentPhaseIndex,
		currentBet: gameState.currentBet,
		pot: gameState.pot,
		smallBlind: gameState.smallBlind,
		bigBlind: gameState.bigBlind,
		chipUnit: gameState.chipUnit ?? 10,
		raisesThisRound: gameState.raisesThisRound,
		lastRaise: gameState.lastRaise,
		communityCards: gameState.communityCards.slice(),
		holeCards: player.holeCards.slice(),
		players: gameState.players.map(projectPlayer),
		handContext: {
			preflopRaiseCount: handContext.preflopRaiseCount,
			preflopAggressorSeatIndex: handContext.preflopAggressorSeatIndex,
			streetAggressorSeatIndex: handContext.streetAggressorSeatIndex,
			flopCheckedThrough: handContext.flopCheckedThrough,
			turnCheckedThrough: handContext.turnCheckedThrough,
			streetCheckCounts: { ...handContext.streetCheckCounts },
			streetAggressiveActionCounts: { ...handContext.streetAggressiveActionCounts },
		},
		legalActions: {
			needToCall: actionState.needToCall,
			canCheck: actionState.canCheck,
			canRaise: actionState.canRaise,
			minRaiseTo: player.roundBet + actionState.minRaise,
			maxRaiseTo: player.roundBet + actionState.maxRaiseAmount,
			stackAmount: actionState.stackAmount,
		},
	};
}
