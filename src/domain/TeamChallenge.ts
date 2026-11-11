import { addCalendarDays } from "../lib/calendar";
export type ChallengeWeek = {
  start: string;
  end: string;
  count: number;
  target: number;
  fulfilled: boolean;
  phase: "future" | "current" | "past";
};
export type ChallengeParticipant = {
  id: string;
  displayName: string;
  response: "invited" | "accepted" | "declined";
  target: number;
  weeks?: ChallengeWeek[];
};
export type TeamChallenge = {
  id: string;
  hostId: string;
  name: string;
  startDate: string;
  endDate: string;
  today: string;
  cancelled: boolean;
  myResponse: ChallengeParticipant["response"];
  participants: ChallengeParticipant[];
};
export class TeamChallengeProgress {
  static weeks(
    start: string,
    today: string,
    target: number,
    counts: { date: string; n: number }[],
  ): ChallengeWeek[] {
    return Array.from({ length: 4 }, (_, i) => {
      const from = addCalendarDays(start, i * 7),
        end = addCalendarDays(from, 6);
      const count = counts
        .filter((c) => c.date >= from && c.date <= end && c.date <= today)
        .reduce((n, c) => n + c.n, 0);
      return {
        start: from,
        end,
        count,
        target,
        fulfilled: count >= target,
        phase: today < from ? "future" : today > end ? "past" : "current",
      };
    });
  }
  static summary(people: ChallengeParticipant[]) {
    const weeks = people.flatMap((p) => p.weeks ?? []);
    let streak = 0,
      best = 0;
    // A completed current week may extend the streak; an unfinished week has time left.
    for (const p of people) {
      streak = 0;
      for (const w of (p.weeks ?? []).filter((w) => w.phase !== "future")) {
        if (w.fulfilled) {
          streak++;
          best = Math.max(best, streak);
        } else if (w.phase === "past") streak = 0;
      }
    }
    const done = weeks.reduce((n, w) => n + Math.min(w.count, w.target), 0),
      target = weeks.reduce((n, w) => n + w.target, 0);
    return {
      done,
      target,
      percent: target ? Math.round((100 * done) / target) : 0,
      fulfilled: weeks.filter((w) => w.fulfilled).length,
      weekGoals: weeks.length,
      bestStreak: best,
    };
  }
  static card(challenge: TeamChallenge, me: ChallengeParticipant) {
    const escape = (s: string) =>
      s.replace(
        /[<>&"']/g,
        (c) =>
          ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
          })[c]!,
      );
    const result = this.summary([me]);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><rect width="960" height="640" rx="32" fill="#111512"/><g font-family="Arial,sans-serif" fill="#eef2e7"><text x="56" y="90" fill="#cafa64" font-size="38" font-weight="700">ТЯГА · 4 НЕДЕЛИ</text><text x="56" y="160" font-size="32">${escape(challenge.name.slice(0, 48))}</text><text x="56" y="205" font-size="22" fill="#a5ae9b">${challenge.startDate} — ${challenge.endDate}</text><text x="56" y="270" font-size="28">${escape(me.displayName)}</text><text x="56" y="355" font-size="64" fill="#cafa64">${result.done} / ${result.target}</text><text x="56" y="400" font-size="24">Недельных целей выполнено: ${result.fulfilled} / 4</text>${(me.weeks ?? []).map((w, i) => `<g transform="translate(${56 + i * 216},450)"><rect width="198" height="104" rx="16" fill="#1c241d"/><text x="18" y="34" font-size="18" fill="#a5ae9b">Неделя ${i + 1}</text><text x="18" y="78" font-size="30" fill="${w.fulfilled ? "#cafa64" : "#eef2e7"}">${w.count} / ${w.target}</text></g>`).join("")}</g></svg>`;
  }
}
