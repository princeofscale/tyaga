import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRelease, newerRelease } from "../src/device/release";

test("a published release record is parsed, and anything else is not a release", () => {
  assert.deepEqual(parseRelease({ versionCode: 3, versionName: "1.2" }), {
    versionCode: 3,
    versionName: "1.2",
  });
  assert.deepEqual(parseRelease({ versionCode: 4 }), {
    versionCode: 4,
    versionName: "",
  });
  for (const broken of [
    null,
    undefined,
    "1.2",
    42,
    [],
    {},
    { versionCode: "3" },
    { versionCode: 3.5 },
    { versionCode: 0 },
  ])
    assert.equal(parseRelease(broken), null, JSON.stringify(broken));
});

test("the banner appears only for a newer build, never for the same or an older one", () => {
  assert.equal(newerRelease({ versionCode: 4, versionName: "1.3" }, 3)?.versionCode, 4);
  assert.equal(newerRelease({ versionCode: 3, versionName: "1.2" }, 3), null);
  assert.equal(newerRelease({ versionCode: 2, versionName: "1.1" }, 3), null);
  assert.equal(newerRelease({ versionCode: 4 }, 3)?.versionName, "");
  // A missing file answers 200 with the site shell: not a release, no banner.
  assert.equal(newerRelease("<html>", 3), null);
  assert.equal(newerRelease(null, 3), null);
});

test("the version the app compares against is read from the Android build itself", () => {
  const gradle = readFileSync(
    new URL("../android/app/build.gradle", import.meta.url),
    "utf8",
  );
  const versionCode = Number(gradle.match(/versionCode (\d+)/)![1]);
  const versionName = gradle.match(/versionName "([^"]+)"/)![1];
  const published = parseRelease({ versionCode, versionName });
  assert.equal(published?.versionCode, versionCode);
  // Its own version is never an update, and the app cannot compare nothing.
  assert.equal(newerRelease(published, versionCode), null);
  assert.ok(newerRelease({ versionCode: versionCode + 1 }, versionCode));
});
