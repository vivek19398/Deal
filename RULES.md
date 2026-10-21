# Dealz rules and local interpretations

This is an original browser implementation of the classic Monopoly Deal card game, for private play. No official artwork or logos are included.

All monetary values are INR crore units, with **₹1 cr** as the minimum banknote. Place names are customized for Bihar; colour groups and game mechanics retain their original meaning.

## Deck and turns

106 playable cards: 28 properties, 11 property wildcards, 13 rent cards, 34 actions and 20 money cards. Physical boxes count four reference cards in their 110-card total; those are not in the draw pile.

Deal five to each player. First seated player starts. Draw two at the beginning of each turn, or five if the hand is empty. Play zero to three cards, then discard down to seven. Pass Go draws two additional cards and costs one play. When the draw pile empties, shuffle the discard pile. If both are empty, draw whatever remains (possibly nothing).

Bank money or action/rent cards; once banked, their only use is monetary. Properties never go in the bank. Build complete sets using the indicated group sizes. The first player with three complete sets of **different colours** wins immediately, including if received through payment.

## Properties and rent

Properties may move between groups of their printed colour during their owner's turn without costing plays; wildcards may also switch between their printed colours. All-colour wildcards have zero monetary value, cannot pay debts, and cannot form a complete set alone. Rearranging is blocked while an action is pending. A wildcard supporting buildings cannot move until the buildings have been legally moved to another complete coloured set. Buildings may move between eligible sets for free during your turn; move a hotel before its supporting house, and a hotel always needs a house at its destination.

Two-colour rent collects from every opponent in seat order. Any-colour rent collects from one chosen opponent. Choose one matching group; separate groups of the same colour do not combine for rent. Each Double the Rent consumes one play, together with the rent card: one double is ×2, two doubles are ×4. Cannot exceed three total plays.

One house on a complete coloured set adds ₹3 cr rent; one hotel requires a house and adds another ₹4 cr. No buildings on railroads/utilities. Buildings remain attached when a full set is stolen. If property payment breaks a set, remaining buildings become banked money. Buildings may also be selected as payment assets directly. This orphan-building handling is a local interpretation.

## Actions and counteractions

Sly Deal steals one property outside a complete set. Forced Deal swaps one of your properties and one of an opponent's, neither from a complete set. Deal Breaker steals a complete set with its buildings. Debt Collector requests ₹5 cr from one opponent; Birthday requests ₹2 cr from each opponent.

The target explicitly accepts an action or plays Just Say No before it resolves. Just Say No can be countered by the original actor, then countered again, alternating until one accepts. Responses consume cards but no turn plays. A block cancels the entire action against that target (including rent multipliers), leaving other targets unaffected. There are no response timers, since this is an in-person game.

## Payments

The debtor chooses cards from their bank and table, never their hand. Pay at least the requested total or every positive-value asset if unable to cover it. Overpayments receive no change. Zero-value universal wildcards stay with the debtor. Received money and banked action cards remain banked. Received properties retain their current colour and join the recipient's first available group, creating another if necessary.

Pending payments and counteractions must finish before ordinary moves can continue. Disconnected current players or required responders pause the game. The owner resumes once those players are connected, or ends the game. No automatic forfeits or bot substitutions.

## Sources

- https://monopolydealrules.com/index.php?page=play
- https://instructions.hasbro.com/en-gb/instruction/monopoly-deal-card-game
- https://hasbro-new.custhelp.com/app/answers/detail/a_id/953/ (Just Say No uses no turn plays)
- https://www.buffalolib.org/sites/default/files/gaming-unplugged/inst/Monopoly%20Deal%20Card%20Game%20Instructions.pdf

The interpretations above are fixed for this version rather than exposed as room settings.
