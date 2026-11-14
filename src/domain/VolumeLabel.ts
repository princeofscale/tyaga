import { fmt } from "../lib/model";

/**
 * How a tonnage figure is shown. A session with no countable free-weight work
 * (a literal import with an unknown weight rule, machines, bodyweight) has no
 * tonnage: that is "—" with a reason, never "0 т" — a zero reads as "you did
 * nothing", and it is also the wrong number to compare with.
 */
export class VolumeLabel {
  static readonly NONE = "—";
  /** "3,4 т", "480 кг" when it would round to 0,0 т, or "—" when there is none. */
  static short(kg: number) {
    if (!(kg > 0)) return this.NONE;
    const tons = Math.round(kg / 100) / 10;
    return tons > 0 ? `${fmt(tons)} т` : `${fmt(Math.round(kg))} кг`;
  }
  /** Why there is no number. */
  static reason(omittedSets: number) {
    return omittedSets > 0
      ? "Тоннаж не считается: вес записан без правила, на тренажёре или с весом тела"
      : "Нет подходов со свободным весом";
  }
  /** A short visible caption for rows, empty when a number is shown. */
  static caption(kg: number, omittedSets: number) {
    return kg > 0 ? "" : omittedSets > 0 ? "тоннаж не считается" : "";
  }
}
