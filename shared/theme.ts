import type { Card, Color } from "./model.js";
/** Game values are crore units; no fractional or sub-crore money cards exist. */
export const money = (crore: number) => `₹${crore} cr`;
export const places: Record<Color, string[]> = {
  brown: ["Manopali", "Mahaura"],
  lightBlue: ["Ara", "Buxar", "Chhapra"],
  pink: ["Darbhanga", "Madhubani", "Muzaffarpur"],
  orange: ["Bhagalpur", "Munger", "Begusarai"],
  red: ["Gaya", "Rajgir", "Bodh Gaya"],
  yellow: ["Jagdeo Path", "Boring Road", "Bailey Road"],
  green: ["Kankarbagh", "Patliputra Colony", "Fraser Road"],
  darkBlue: ["Gandhi Maidan", "Patna Marine Drive"],
  railroad: [
    "Patna Junction",
    "Ara Junction",
    "Bhagalpur Junction",
    "Gaya Junction",
  ],
  utility: ["PWC Department", "Bijli Department"],
};
export const cardName = (card: Card) =>
  card.kind === "money" ? money(card.value) : card.name;
