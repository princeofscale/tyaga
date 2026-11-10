import { addCalendarDays, localDate, weekStart } from "../lib/calendar";
import { volumeSummary, workingSets } from "../lib/model";
import type { Workout } from "../lib/types";

export interface GymStatus {
  gym: string;
  focus: string;
  activeUntil: number;
}
export interface Athlete extends GymStatus {
  id: string;
  displayName: string;
  weekWorkouts: number;
}
export interface FriendRequest {
  id: string;
  displayName: string;
  direction: "incoming" | "outgoing";
}
export interface FriendWorkout {
  id: string;
  athleteId: string;
  displayName: string;
  name: string;
  date: string;
  duration: number;
  setsCount: number;
  volumeKg: number;
  kudosCount: number;
  hasGivenKudos: boolean;
}
export interface FriendsData {
  me: Athlete & { inviteCode: string };
  friends: Athlete[];
  requests: FriendRequest[];
  feed: FriendWorkout[];
  weekStart: string;
  today: string;
  serverTime: number;
}

/** Shared social rules. No synthetic athletes, presence or workout history. */
export class FriendsService {
  static readonly gymSessionMs = 2 * 60 * 60 * 1000;
  static readonly weeklyTarget = 3;

  /** Normalizes a copied code or invitation URL; never performs a network lookup. */
  static inviteCode(value: string): string | null {
    let code = value.trim();
    try {
      if (/^https?:\/\//i.test(code))
        code = new URL(code).searchParams.get("friend") ?? "";
    } catch {
      return null;
    }
    code = code.replace(/[\s\-\u2010-\u2015]/g, "").toUpperCase();
    return /^[A-F0-9]{12}$/.test(code) ? code : null;
  }

  /** Uses the viewer’s calendar for weekly and 30-day social ranges. */
  static week(now: Date, timeZone: string) {
    const today = localDate(now, timeZone);
    return {
      today,
      start: weekStart(now, timeZone),
      feedStart: addCalendarDays(today, -29),
    };
  }

  /** Reduces a workout to completed work and supported free-weight volume. */
  static workout(workout: Workout) {
    return {
      setsCount: workingSets([workout]),
      volumeKg: volumeSummary([workout]).total,
    };
  }

  /** Caps each contribution so one athlete cannot fill another’s weekly target. */
  static teamProgress(athletes: Athlete[]) {
    const target = athletes.length * this.weeklyTarget;
    const done = athletes.reduce(
      (sum, athlete) => sum + Math.min(this.weeklyTarget, athlete.weekWorkouts),
      0,
    );
    return {
      done,
      target,
      percent: target ? Math.round((100 * done) / target) : 0,
    };
  }
}
