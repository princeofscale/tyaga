export type MeetupParticipant = {
  id: string;
  displayName: string;
  response: "invited" | "accepted" | "declined" | "finished";
  gym: string;
  summary?: {
    name: string;
    setsCount: number;
    volumeKg: number;
    duration: number;
  };
};
export type TrainingMeetup = {
  id: string;
  hostId: string;
  hostName: string;
  name: string;
  startsAt: string;
  gym: string;
  cancelled: boolean;
  myResponse: MeetupParticipant["response"];
  participants: MeetupParticipant[];
};
/** Meeting timestamps are instants; the form explicitly uses the device's local timezone. */
export class TrainingMeetups {
  static iso(local: string) {
    const d = new Date(local);
    if (!Number.isFinite(d.getTime()))
      throw new Error("Укажи дату и время тренировки");
    return d.toISOString();
  }
  static initialTime(now = new Date()) {
    const d = new Date(now.getTime() + 3600000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  static summary(participants: MeetupParticipant[]) {
    const finished = participants.filter((p) => p.summary);
    return {
      finished: finished.length,
      sets: finished.reduce((n, p) => n + p.summary!.setsCount, 0),
      minutes: finished.reduce((n, p) => n + p.summary!.duration, 0),
    };
  }
}
