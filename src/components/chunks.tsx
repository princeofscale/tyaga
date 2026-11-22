import { lazyChunk } from "./lazyChunk";

/** Все отдельно загружаемые экраны. Каждый при отказе показывает «Повторить», а не роняет приложение. */
export const ExerciseLibrary = lazyChunk(() => import("./ExerciseLibrary"), "Каталог не загрузился");
export const AnatomyExplorer = lazyChunk(() => import("./AnatomyExplorer"), "Атлас не загрузился");
export const ProgramsScreen = lazyChunk(() => import("./ProgramsScreen"), "Программы не загрузились");
export const FriendsScreen = lazyChunk(() => import("./FriendsScreen"), "Напарники не загрузились");
export const PersonalExerciseEditor = lazyChunk(() => import("./PersonalExerciseEditor"), "Редактор не загрузился");
export const HistoryImporter = lazyChunk(() => import("./HistoryImporter"), "Импорт не загрузился");
export const AppleHealthPanel = lazyChunk(() => import("./AppleHealthPanel"), "Показатели часов не загрузились");
export const CloudSyncPanel = lazyChunk(() => import("./CloudSyncPanel"), "Облако не загрузилось");
export const PoseAnalysisPanel = lazyChunk(() => import("./PoseAnalysisPanel"), "Анализ видео не загрузился");
export const WorkoutDetailModal = lazyChunk(() => import("./WorkoutDetailModal"), "Окно тренировки не загрузилось");
