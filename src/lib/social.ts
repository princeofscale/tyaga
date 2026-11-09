/** Типы раздела «Напарники»: одни и те же для сервера и интерфейса. */
export type AthleteProfile = { tag: string; bio: string; isPublic: boolean };

export type FeedWorkout = {
  id: string;
  date: string;
  title: string;
  sets: number;
  tonnageKg: number;
  duration: number;
  muscles: string[];
  kudos: number;
  kudosByMe: boolean;
  athlete: { tag: string; displayName: string };
};

export type FollowedAthlete = {
  tag: string;
  displayName: string;
  bio: string;
  lastDate: string | null;
  workoutsLast7Days: number;
};

export type SocialOverview = {
  profile: AthleteProfile | null;
  followers: number;
  following: FollowedAthlete[];
  feed: FeedWorkout[];
};

export const MAX_FOLLOWING = 50;
export const TAG_PATTERN = /^[a-z0-9_]{3,20}$/;

/** «@Ivan_Power » → «ivan_power»; пустая строка остаётся пустой. */
export const normalizeTag = (value: string) => value.trim().replace(/^@+/, "").toLowerCase();
