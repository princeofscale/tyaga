import test from "node:test";
import assert from "node:assert/strict";
import { FriendsService } from "../src/domain/FriendsService";

// Mock localStorage for node environment
const store = new Map<string, string>();
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.localStorage = mockStorage as any;

test("FriendsService returns default starter friends and saves to storage", () => {
  store.clear();
  const service = new FriendsService("user-1");
  const friends = service.getFriends();
  assert.equal(friends.length, 3);
  assert.equal(friends[0].tag, "@dmitry_titan");
});

test("FriendsService adds a new friend with proper tag formatting", () => {
  store.clear();
  const service = new FriendsService("user-1");
  const newFriend = service.addFriend("ivan_power");
  assert.equal(newFriend.tag, "@ivan_power");
  assert.equal(newFriend.displayName, "Ivan_power");

  const friends = service.getFriends();
  assert.equal(friends.length, 4);

  // Re-adding same friend throws error
  assert.throws(() => service.addFriend("@ivan_power"), /уже в твоём списке/);
});

test("FriendsService toggles kudos with count changes", () => {
  store.clear();
  const service = new FriendsService("user-1");
  const initial = service.getFriends()[0];
  const initialCount = initial.kudosCount;

  const result1 = service.giveKudos(initial.id);
  assert.equal(result1.kudosCount, initialCount + 1);
  assert.equal(result1.hasGivenKudos, true);

  const result2 = service.giveKudos(initial.id);
  assert.equal(result2.kudosCount, initialCount);
  assert.equal(result2.hasGivenKudos, false);
});

test("FriendsService manages athlete profile", () => {
  store.clear();
  const service = new FriendsService("user-1");
  const profile = service.getAthleteProfile("Иван Петров");
  assert.ok(profile.tag.startsWith("@"));
  assert.equal(profile.isPublic, true);

  profile.bio = "Мастер спорта по пауэрлифтингу";
  profile.isPublic = false;
  service.saveAthleteProfile(profile);

  const reloaded = service.getAthleteProfile("Иван Петров");
  assert.equal(reloaded.bio, "Мастер спорта по пауэрлифтингу");
  assert.equal(reloaded.isPublic, false);
});
