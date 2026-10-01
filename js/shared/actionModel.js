/* ==================================================================================================
MODULE BOUNDARY: Shared Action Model
================================================================================================== */

// CURRENT STATE: Single shared source of truth for check, call, raise, and all-in amount math used
// by host and seat controls.
// TARGET STATE: Keep all action math that can be derived from explicit game state in one place so
// every UI uses the same rules.
// PUT HERE: Amount normalization, button labels, and semantic action derivation from explicit game
// state.
// DO NOT PUT HERE: Action submission, DOM control handling, polling, or turn-flow ownership.

export function getPlayerActionState(gameState, player) {
	const needToCall = Math.max(0, gameState.currentBet - player.roundBet);
	const minAmount = gameState.currentPhaseIndex > 0 && gameState.currentBet === 0
		? 0
		: Math.min(needToCall, player.chips);
	const minRaise = needToCall + gameState.lastRaise;
	const effectiveRaiseCap = getEffectiveRaiseCap(gameState, player);
	const actedThisStreet = player.spotState?.actedThisStreet === true;
	const facedFullRaise = gameState.currentBet - player.roundBet >= gameState.lastRaise;
	const facingOpeningBetAfterCheck = player.roundBet === 0 && gameState.currentBet > 0;
	const maxCallableRaiseAmount = Math.min(player.chips, effectiveRaiseCap);
	const canRaise = maxCallableRaiseAmount > needToCall &&
		(maxCallableRaiseAmount >= minRaise || maxCallableRaiseAmount === player.chips) &&
		(!actedThisStreet || facedFullRaise || facingOpeningBetAfterCheck);
	const maxAmount = canRaise ? maxCallableRaiseAmount : Math.min(needToCall, player.chips);
	const maxRaiseAmount = maxAmount;
	return {
		needToCall,
		potAmount: gameState.pot,
		currentBet: gameState.currentBet,
		roundBet: player.roundBet,
		currentPhaseIndex: gameState.currentPhaseIndex,
		raisesThisRound: gameState.raisesThisRound,
		minAmount,
		maxAmount,
		stackAmount: player.chips,
		minRaise,
		maxRaiseAmount,
		canCheck: needToCall === 0,
		canRaise,
		chipUnit: gameState.chipUnit ?? 10,
	};
}

export function getEffectiveRaiseCap(gameState, player) {
	const maxOpponentTotal = gameState.players.reduce((maxTotal, currentPlayer) => {
		if (
			currentPlayer === player ||
			currentPlayer.folded ||
			currentPlayer.allIn ||
			currentPlayer.chips <= 0
		) {
			return maxTotal;
		}

		return Math.max(maxTotal, currentPlayer.roundBet + currentPlayer.chips);
	}, 0);

	return Math.max(0, maxOpponentTotal - player.roundBet);
}

export function getActionButtonLabel(amount, actionState) {
	if (amount === 0) {
		return "Check";
	}
	if (amount === actionState.needToCall) {
		return amount === actionState.stackAmount
			? "All-In"
			: "Call";
	}
	if (amount === actionState.maxAmount) {
		return amount === actionState.stackAmount ? "All-In" : "Raise";
	}
	return "Raise";
}

export function clampActionAmount(amount, actionState) {
	const parsedAmount = Number.isNaN(amount) ? actionState.minAmount : amount;
	return Math.max(
		actionState.minAmount,
		Math.min(parsedAmount, actionState.maxAmount),
	);
}

export function isInvalidRaiseAmount(amount, actionState) {
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	return amount > actionState.needToCall &&
		(amount < actionState.minRaise || amount > maxRaiseAmount) &&
		amount < actionState.maxAmount;
}

export function normalizeActionAmount(amount, actionState) {
	const clampedAmount = clampActionAmount(amount, actionState);
	const maxRaiseAmount = actionState.maxRaiseAmount ?? actionState.maxAmount;
	if (clampedAmount === actionState.maxAmount) {
		return clampedAmount;
	}
	if (clampedAmount > maxRaiseAmount) {
		return maxRaiseAmount;
	}
	if (isInvalidRaiseAmount(clampedAmount, actionState)) {
		return Math.min(maxRaiseAmount, actionState.minRaise);
	}
	return clampedAmount;
}

export function getPotFractionActionAmount(actionState, percent) {
	if (!actionState?.canRaise || !Number.isSafeInteger(actionState.potAmount) ||
		!Number.isSafeInteger(percent) || percent <= 0) {
		return null;
	}
	const chipUnit = actionState.chipUnit ?? 1;
	const potAfterCall = actionState.potAmount + actionState.needToCall;
	const raiseSize = Math.round((potAfterCall * percent) / (100 * chipUnit)) * chipUnit;
	const requestedAmount = actionState.needToCall + raiseSize;
	if (requestedAmount < actionState.minRaise && requestedAmount < actionState.maxAmount) {
		return null;
	}
	const amount = normalizeActionAmount(requestedAmount, actionState);
	return amount > actionState.needToCall ? amount : null;
}

export function getThreeBetActionAmount(actionState, multiple) {
	if (!actionState?.canRaise || actionState.currentPhaseIndex !== 0 ||
		actionState.raisesThisRound !== 1 || !Number.isSafeInteger(actionState.currentBet) ||
		!Number.isSafeInteger(actionState.roundBet) || ![3, 4].includes(multiple)) {
		return null;
	}
	const chipUnit = actionState.chipUnit ?? 1;
	const targetTotal = Math.round((actionState.currentBet * multiple) / chipUnit) * chipUnit;
	const amount = targetTotal - actionState.roundBet;
	if (amount <= actionState.needToCall || amount > actionState.maxAmount ||
		(amount < actionState.minRaise && amount !== actionState.stackAmount)) {
		return null;
	}
	return amount;
}

// The UIs submit semantic actions, but both UIs derive them from the same slider state.
export function getActionRequestForAmount(amount, actionState) {
	const normalizedAmount = normalizeActionAmount(amount, actionState);

	if (normalizedAmount === 0) {
		return { action: "check", amount: 0 };
	}
	if (normalizedAmount === actionState.needToCall) {
		return normalizedAmount === actionState.stackAmount
			? { action: "allin", amount: normalizedAmount }
			: { action: "call", amount: normalizedAmount };
	}
	if (normalizedAmount === actionState.maxAmount) {
		return normalizedAmount === actionState.stackAmount
			? { action: "allin", amount: normalizedAmount }
			: { action: "raise", amount: normalizedAmount };
	}
	return { action: "raise", amount: normalizedAmount };
}

export function toSeatDecisionRequest(player, actionRequest) {
	if (!actionRequest) {
		return null;
	}
	return actionRequest.action === "raise"
		? { action: "raise", raiseTo: player.roundBet + actionRequest.amount }
		: { action: actionRequest.action };
}
