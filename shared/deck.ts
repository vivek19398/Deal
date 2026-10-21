import { places, money } from "./theme.js";
import { colors, groups, type Card, type Color, type Action } from "./model.js";
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  const add = (c: Omit<Card, "id">, n = 1) => {
    for (let i = 0; i < n; i++) deck.push({ ...c, id: `c${deck.length + 1}` });
  };
  for (const color of colors)
    for (const name of places[color])
      add({
        kind: "property",
        name,
        value: groups[color].value,
        colors: [color],
      });
  const wild = (cs: Color[], n: number, v: number) =>
    add(
      {
        kind: "wild",
        name:
          cs.length === 10
            ? "Universal wild"
            : cs.map((c) => groups[c].name).join(" / "),
        value: v,
        colors: cs,
      },
      n,
    );
  wild(["brown", "lightBlue"], 1, 1);
  wild(["pink", "orange"], 2, 2);
  wild(["red", "yellow"], 2, 3);
  wild(["green", "darkBlue"], 1, 4);
  wild(["railroad", "green"], 1, 4);
  wild(["railroad", "lightBlue"], 1, 4);
  wild(["railroad", "utility"], 1, 2);
  wild([...colors], 2, 0);
  for (const cs of [
    ["brown", "lightBlue"],
    ["pink", "orange"],
    ["red", "yellow"],
    ["green", "darkBlue"],
    ["railroad", "utility"],
  ] as Color[][])
    add({ kind: "rent", name: "Rent", value: 1, colors: cs }, 2);
  add(
    { kind: "rent", name: "Any-colour rent", value: 3, colors: [...colors] },
    3,
  );
  const actions: [Action, string, number, number][] = [
    ["passGo", "Pass Go", 1, 10],
    ["slyDeal", "Sly Deal", 3, 3],
    ["forcedDeal", "Forced Deal", 3, 3],
    ["dealBreaker", "Deal Breaker", 5, 2],
    ["debt", "Debt Collector", 3, 3],
    ["birthday", "It’s My Birthday", 2, 3],
    ["no", "Just Say No", 4, 3],
    ["double", "Double the Rent", 1, 2],
    ["house", "House", 3, 3],
    ["hotel", "Hotel", 4, 2],
  ];
  for (const [action, name, value, n] of actions)
    add({ kind: "action", name, value, action }, n);
  for (const [value, n] of [
    [1, 6],
    [2, 5],
    [3, 3],
    [4, 3],
    [5, 2],
    [10, 1],
  ])
    add({ kind: "money", name: money(value), value }, n);
  return deck;
}
export function shuffle<T>(cards: T[], random: () => number): T[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
