import test from "node:test";
import assert from "node:assert/strict";
import { SessionReport } from "../src/domain/SessionReport";
import { WarmupPlanner } from "../src/domain/WarmupPlanner";
import { makeWorkout, muscleLoad, exerciseCatalog } from "../src/lib/model";
import { AppleHealthImport, healthDate } from "../src/domain/AppleHealthImport";
import { WgerExerciseAdapter, type WgerSnapshot } from "../src/domain/WgerExercise";
import reviewed from "../data/wger/catalog-v3-reviewed.json";
import previous from "../data/wger/catalog-v2-ru.json";
import { PersonalExerciseFactory } from "../server/PersonalExerciseFactory";
test("50 kg bench scaffolds 20/30/40 warmups; total work and direct preparation remain visible separately",()=> {
  const w=makeWorkout(["bench"]); w.exercises[0].sets=w.exercises[0].sets.slice(0,1); w.exercises[0].sets[0].weight=50; w.exercises[0].sets[0].reps=8; w.exercises[0].sets[0].done=true;
  const warm=new WarmupPlanner(w.exercises[0]).create();
  assert.deepEqual(warm.map(s=>s.weight),[20,30,40]); assert.ok(warm.every(s=>s.rir===null && s.warmup && !s.done));
  w.exercises[0].sets=[...warm.map(s=>({...s,done:true})),...w.exercises[0].sets];
  const report=new SessionReport(w); assert.deepEqual(report.sets,{working:1,warmup:3,total:4});
  assert.equal(report.volume.working.total,400); assert.equal(report.volume.warmup.total,430); assert.equal(report.volume.all.total,830);
  assert.equal(report.muscles.find(m=>m.id==="chest")!.direct,1); assert.equal(report.muscles.find(m=>m.id==="chest")!.warmup,3);
  assert.equal(muscleLoad([w]).find(m=>m.id==="chest")!.direct,1);
});
test("reviewed wger release enables explicit roles while the previous saved definition stays unchanged",()=> {
  const now=reviewed as WgerSnapshot, old=previous as WgerSnapshot;
  assert.equal(now.exercises.filter(r=>r.review).length,26);
  const source=now.exercises.find(r=>r.sourceId===369)!;
  const adapted=new WgerExerciseAdapter(now.release,now.fetchedAt).toExercise(source);
  const before=new WgerExerciseAdapter(old.release,old.fetchedAt).toExercise(old.exercises.find(r=>r.sourceId===369)!);
  assert.notEqual(adapted.id,before.id); assert.deepEqual(before.primary,[]); assert.deepEqual(adapted.primary,["quads"]);
  assert.equal(adapted.recording.loadMode,"machine_stack"); assert.equal(adapted.recording.e1rmEligible,false);
  for(const r of now.exercises.filter(r=>r.review)) assert.ok(new WgerExerciseAdapter(now.release,now.fetchedAt).toExercise(r).muscles.length);
});
test("personal machine can declare a stable movement template without inventing a 1RM",async()=> {
  const input={familyId:"machine-bench",name:"Мой жим от груди",aliases:["Hammer chest"],notes:"Сиденье 3",equipment:"gym",declaredZones:[],basedOnExerciseId:"bench",recording:{type:"reps",loadMode:"machine_stack",implementCount:1,laterality:"bilateral"}};
  const exercise=await new PersonalExerciseFactory().create(input);
  assert.deepEqual(exercise.primary,["chest","triceps"]); assert.equal(exercise.provenance.reviewStatus,"user-declared"); assert.equal(exercise.recording.e1rmEligible,false);
  exerciseCatalog.register([exercise]);
  const revised=await new PersonalExerciseFactory().create({...input,basedOnExerciseId:"row"}); assert.notEqual(revised.id,exercise.id);
});
const xml=`<?xml version="1.0"?><!DOCTYPE HealthData><HealthData>
<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="My Watch" startDate="2026-10-07 18:00:00 +0200" endDate="2026-10-07 18:00:00 +0200" unit="count/min" value="110"/>
<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="My Watch" startDate="2026-10-07 18:05:00 +0200" endDate="2026-10-07 18:05:00 +0200" unit="count/min" value="130"/>
<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Other App" startDate="2026-10-07 18:05:00 +0200" endDate="2026-10-07 18:05:00 +0200" unit="count/min" value="190"/>
<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="My Watch" startDate="2026-10-07 20:05:00 +0200" endDate="2026-10-07 20:05:00 +0200" unit="count/min" value="160"/>
<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" sourceName="My Watch" startDate="2026-10-07 18:00:00 +0200" endDate="2026-10-07 19:00:00 +0200" duration="60" durationUnit="min" totalEnergyBurned="300" totalEnergyBurnedUnit="kcal">
<WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="836.8" unit="kJ"/>
</Workout><Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="My Watch" startDate="2026-10-07 18:00:00 +0200" endDate="2026-10-07 19:00:00 +0200"/>
</HealthData>`;
test("streaming Apple Health matches strength sessions, timezone and source; converts energy and omits unrelated health",()=> {
  const p=new AppleHealthImport("2026-10-07","Europe/Amsterdam"); for(let i=0;i<xml.length;i+=37) p.write(xml.slice(i,i+37));
  const results=p.finish(); assert.equal(results.length,1); assert.equal(results[0].heartRateAverage,120); assert.equal(results[0].heartRateSamples,2);
  assert.ok(Math.abs(results[0].caloriesKcal! - 200) < 1e-9); assert.equal(results[0].energyKind,"active"); assert.equal(results[0].startedAt,"2026-10-07T16:00:00.000Z");
  assert.equal(healthDate("2026-10-07 18:00:00"),NaN);
  const other=new AppleHealthImport("2026-10-08","Europe/Amsterdam"); other.write(xml); assert.deepEqual(other.finish(),[]);
  const invalid=new AppleHealthImport("2026-10-07","UTC"); assert.throws(()=>{invalid.write("<HealthData>");invalid.finish();});
});
