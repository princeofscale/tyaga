export interface GymFriend {
  id: string;
  tag: string;
  displayName: string;
  avatarColor: string;
  level: string;
  statusText: string;
  inGym: boolean;
  streakWeeks: number;
  recentWorkout: {
    name: string;
    date: string;
    volumeKg: number;
    setsCount: number;
    highlight: string;
  };
  kudosCount: number;
  hasGivenKudos: boolean;
}

export interface UserAthleteProfile {
  tag: string;
  bio: string;
  level: string;
  favoriteLift: string;
  avatarColor: string;
  isPublic: boolean;
}

const DEFAULT_FRIENDS: GymFriend[] = [
  {
    id: "friend-1",
    tag: "@dmitry_titan",
    displayName: "Дмитрий «Титан»",
    avatarColor: "#cafa64",
    level: "Мастер жима лёжа",
    statusText: "Сегодня день груди и трицепса 🦾",
    inGym: true,
    streakWeeks: 6,
    recentWorkout: {
      name: "Тяжёлый жим и дельты",
      date: "Вчера",
      volumeKg: 5800,
      setsCount: 16,
      highlight: "Жим штанги 120 кг × 5",
    },
    kudosCount: 14,
    hasGivenKudos: false,
  },
  {
    id: "friend-2",
    tag: "@elena_fit",
    displayName: "Елена В.",
    avatarColor: "#ff9d42",
    level: "Атлет Тяги",
    statusText: "Прогрессирую каждую неделю ⚡",
    inGym: false,
    streakWeeks: 4,
    recentWorkout: {
      name: "Приседания и кор",
      date: "Сегодня",
      volumeKg: 3400,
      setsCount: 12,
      highlight: "Присед 85 кг × 8",
    },
    kudosCount: 9,
    hasGivenKudos: false,
  },
  {
    id: "friend-3",
    tag: "@artem_beast",
    displayName: "Артём Ковалев",
    avatarColor: "#b6a1e8",
    level: "Тяжелоатлет",
    statusText: "Дисциплина бьёт талант",
    inGym: false,
    streakWeeks: 8,
    recentWorkout: {
      name: "Становая тяга и спина",
      date: "2 дня назад",
      volumeKg: 6200,
      setsCount: 15,
      highlight: "Становая тяга 160 кг × 4",
    },
    kudosCount: 22,
    hasGivenKudos: false,
  },
];

export class FriendsService {
  private storageKey: string;
  private profileKey: string;

  constructor(private accountId: string) {
    this.storageKey = `tyaga-friends:${accountId}`;
    this.profileKey = `tyaga-athlete-profile:${accountId}`;
  }

  getFriends(): GymFriend[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        this.saveFriends(DEFAULT_FRIENDS);
        return DEFAULT_FRIENDS;
      }
      return JSON.parse(raw);
    } catch {
      return DEFAULT_FRIENDS;
    }
  }

  saveFriends(friends: GymFriend[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(friends));
    } catch {
      // storage unavailable
    }
  }

  addFriend(tagOrName: string): GymFriend {
    const friends = this.getFriends();
    const cleanTag = tagOrName.trim().startsWith("@")
      ? tagOrName.trim().toLowerCase()
      : `@${tagOrName.trim().toLowerCase().replace(/\s+/g, "_")}`;

    const cleanName = tagOrName.trim().replace(/^@/, "");

    // Check if friend already exists
    const existing = friends.find((f) => f.tag.toLowerCase() === cleanTag);
    if (existing) {
      throw new Error("Этот атлет уже в твоём списке друзей");
    }

    const colors = ["#cafa64", "#ff9d42", "#b6a1e8", "#58c0ff", "#ff7676"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const newFriend: GymFriend = {
      id: `friend-${Date.now()}`,
      tag: cleanTag,
      displayName: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
      avatarColor: randomColor,
      level: "Атлет Тяги",
      statusText: "Тренируется в Тяге 🦾",
      inGym: Math.random() > 0.5,
      streakWeeks: 1,
      recentWorkout: {
        name: "Силовая тренировка",
        date: "Недавно",
        volumeKg: 2800,
        setsCount: 10,
        highlight: "10 рабочих подходов",
      },
      kudosCount: 0,
      hasGivenKudos: false,
    };

    const updated = [newFriend, ...friends];
    this.saveFriends(updated);
    return newFriend;
  }

  removeFriend(id: string): void {
    const friends = this.getFriends().filter((f) => f.id !== id);
    this.saveFriends(friends);
  }

  giveKudos(friendId: string): { kudosCount: number; hasGivenKudos: boolean } {
    const friends = this.getFriends();
    const target = friends.find((f) => f.id === friendId);
    if (!target) return { kudosCount: 0, hasGivenKudos: false };

    if (target.hasGivenKudos) {
      target.kudosCount = Math.max(0, target.kudosCount - 1);
      target.hasGivenKudos = false;
    } else {
      target.kudosCount += 1;
      target.hasGivenKudos = true;
    }

    this.saveFriends(friends);
    return { kudosCount: target.kudosCount, hasGivenKudos: target.hasGivenKudos };
  }

  getAthleteProfile(displayName: string): UserAthleteProfile {
    try {
      const raw = localStorage.getItem(this.profileKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...parsed,
          isPublic: parsed.isPublic ?? true,
        };
      }
    } catch {
      // fallback
    }

    const defaultTag = `@${displayName.toLowerCase().replace(/[^a-z0-9а-яё_]/gi, "_").replace(/_+/g, "_") || "athlete"}`;
    const defaultProfile: UserAthleteProfile = {
      tag: defaultTag,
      bio: "Жму, тяну, приседаю. В Тяге ради прогресса 🦾",
      level: "Атлет Тяги",
      favoriteLift: "Жим штанги лёжа",
      avatarColor: "#cafa64",
      isPublic: true,
    };
    return defaultProfile;
  }

  saveAthleteProfile(profile: UserAthleteProfile): void {
    try {
      localStorage.setItem(this.profileKey, JSON.stringify(profile));
    } catch {
      // storage unavailable
    }
  }
}
