import type { ComponentType } from "react";
import { lazyChunk } from "./lazyChunk";

function lazyNamed<P extends object>(
  load: () => Promise<ComponentType<P>>,
  title: string,
) {
  return lazyChunk<P>(() => load().then((Component) => ({ default: Component })), title);
}

/** Все отдельно загружаемые экраны и модальные инструменты. Каждый при отказе показывает «Повторить», а не роняет приложение. */
export const WorkoutView = lazyChunk(() => import("./WorkoutView"), "Экран тренировки не загрузился");
export const ExerciseLibrary = lazyChunk(() => import("./ExerciseLibrary"), "Каталог не загрузился");
export const AnatomyExplorer = lazyChunk(() => import("./AnatomyExplorer"), "Атлас не загрузился");
export const ProgramsScreen = lazyChunk(() => import("./ProgramsScreen"), "Программы не загрузились");
export const FriendsScreen = lazyChunk(() => import("./FriendsScreen"), "Напарники не загрузились");
export const PersonalExerciseEditor = lazyChunk(() => import("./PersonalExerciseEditor"), "Редактор не загрузился");
export const HistoryImporter = lazyChunk(() => import("./HistoryImporter"), "Импорт не загрузился");
export const AppleHealthPanel = lazyChunk(() => import("./AppleHealthPanel"), "Показатели часов не загрузились");
export const CloudSyncPanel = lazyChunk(() => import("./CloudSyncPanel"), "Облако не загрузилось");
export const WorkoutDetailModal = lazyChunk(() => import("./WorkoutDetailModal"), "Окно тренировки не загрузилось");
export const ProgressScreen = lazyChunk(() => import("../features/progress/ProgressScreen"), "Раздел прогресса не загрузился");
export const HistoryScreen = lazyChunk(() => import("../features/history/HistoryScreen"), "История не загрузилась");
export const SupplementsScreen = lazyChunk(() => import("./SupplementsScreen"), "Добавки не загрузились");
export const PlateCalculator = lazyChunk(() => import("./PlateCalculator"), "Калькулятор блинов не загрузился");
export const OneRepMaxCalculator = lazyChunk(() => import("./OneRepMaxCalculator"), "Калькулятор 1ПМ не загрузился");
export const MachineManager = lazyChunk(() => import("./MachineManager"), "Тренажёры не загрузились");
export const RestNotificationSettings = lazyChunk(() => import("./RestNotificationSettings"), "Уведомления не загрузились");
export const AccountProfileForm = lazyNamed(
  () => import("./AccountProfileForm").then((m) => m.AccountProfileForm),
  "Профиль не загрузился",
);
export const BodyweightModal = lazyNamed(
  () => import("./BodyweightModal").then((m) => m.BodyweightModal),
  "Журнал веса не загрузился",
);
export const DeloadModal = lazyNamed(
  () => import("./DeloadModal").then((m) => m.DeloadModal),
  "Разгрузочная неделя не загрузилась",
);
export const WarmupModal = lazyNamed(
  () => import("./WarmupModal").then((m) => m.WarmupModal),
  "Разминочная лесенка не загрузилась",
);
export const IosInstallPrompt = lazyNamed(
  () => import("./IosInstallPrompt").then((m) => m.IosInstallPrompt),
  "Инструкция не загрузилась",
);
export const VolumeLandmarksModal = lazyNamed(
  () => import("./VolumeLandmarksModal").then((m) => m.VolumeLandmarksModal),
  "Ориентиры объёма не загрузились",
);
