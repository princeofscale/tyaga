import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path='artifacts/models/pose_landmarker_lite_v1.task';
const url='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const expected='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
let bytes=await readFile(path).catch(()=>null);
if(!bytes){const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Model download: ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Unexpected MediaPipe test model checksum');
await mkdir('artifacts/models',{recursive:true});await writeFile(path,bytes);
console.log('Verified MediaPipe Pose Landmarker Lite v1 test model');
const imagePath='artifacts/models/pose.jpg';
let image=await readFile(imagePath).catch(()=>null);
if(!image){const response=await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg',{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Pose fixture: ${response.status}`);image=Buffer.from(await response.arrayBuffer());}
if(createHash('sha256').update(image).digest('hex')!=='c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b')throw new Error('Unexpected official pose fixture checksum');
await writeFile(imagePath,image);
