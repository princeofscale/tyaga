import { Suspense, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Download, Dumbbell, RotateCcw, Shield, Sparkles } from "lucide-react";
import { AVOID_REASON_LABELS, ExerciseAvoidStore } from "../../domain/SubstitutionPolicy";
import {
  GYM_BAR_OPTIONS,
  GYM_MIN_PLATE_OPTIONS,
  GymInventoryStore,
  type GymInventory,
} from "../../domain/GymInventory";
import {
  BiomechanicsProfileStore,
  type BiomechanicsProfile,
} from "../../domain/BiomechanicsProfile";
import {
  DEFAULT_SETTINGS,
  MUSCLES,
  browserTimeZone,
  exerciseById,
  exerciseCatalog,
  repeatWorkout,
  type Equipment,
  type Exercise,
  type ProductData,
  type Routine,
  type Settings,
  type Workout,
} from "../../lib/model";
import type { AccountProfile } from "../../lib/account";
import { newDraft, type Draft } from "../../lib/draft";
import { TrainingProgram } from "../../domain/TrainingProgram";
import { WorkoutSession } from "../../domain/WorkoutSession";
import { WorkoutConflict } from "../../domain/WorkoutConflict";
import type { DeloadMode } from "../../domain/DeloadEngine";
import type { DeloadApplication, DeloadPlanRecord } from "../../domain/DeloadPlan";
import type { ImportRecord } from "../../domain/ImportUndo";
import { applyTheme, type ThemeId } from "../../lib/theme";
import { api } from "../../services/ApiClient";
import { productService } from "../../services/ProductService";
import { importService } from "../../services/ImportService";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import ExerciseInfo from "../../components/ExerciseInfo";
import { TimeZoneField } from "../../components/TimeZoneField";
import ToolsHub from "../../components/ToolsHub";
import {
  AccountProfileForm,
  BodyweightModal,
  DeloadModal,
  HistoryImporter,
  IosInstallPrompt,
  MachineManager,
  OneRepMaxCalculator,
  PersonalExerciseEditor,
  PlateCalculator,
  RestNotificationSettings,
  VolumeLandmarksModal,
  WarmupModal,
  WorkoutDetailModal,
} from "../../components/chunks";
import type { ProductView } from "../navigation/AppChrome";

export type AppModalId =
  | "machines"
  | "tools"
  | "backup"
  | "rest_notifications"
  | "picker"
  | "settings"
  | "method"
  | "personal"
  | "import"
  | "profile"
  | "plate"
  | "orm"
  | "bodyweight"
  | "deload"
  | "warmup"
  | "ios_install"
  | "restore"
  | "rp_volume"
  | null;

const EQ_OPTIONS = [
  { value: "gym", label: "Весь зал" },
  { value: "dumbbells", label: "Гантели" },
  { value: "bodyweight", label: "Без оборудования" },
];

const ModalFallback = () => (
  <div className="loading-state" role="status">
    <span className="loader" />
    Загружаем…
  </div>
);

function GymInventorySettings() {
  const [inv, setInv] = useState<GymInventory>(() => GymInventoryStore.read());
  const update = (patch: Partial<GymInventory>) => {
    setInv((prev) => GymInventoryStore.save({ ...prev, ...patch }));
  };
  return (
    <section className="settings-inventory" aria-label="Инвентарь зала">
      <div className="settings-inventory-head">
        <Dumbbell size={14} aria-hidden="true" />
        <b>Инвентарь зала</b>
        <small>для калькулятора блинов и разминки</small>
      </div>
      <div className="settings-inventory-row">
        <span>Гриф по умолчанию</span>
        <div className="settings-pill-group" role="group" aria-label="Вес грифа по умолчанию">
          {GYM_BAR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-pill${inv.barWeightKg === opt.value ? " active" : ""}`}
              aria-pressed={inv.barWeightKg === opt.value}
              onClick={() => update({ barWeightKg: opt.value })}
            >
              {opt.short}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-inventory-row">
        <span>Минимальный блин</span>
        <div className="settings-pill-group" role="group" aria-label="Минимальный блин">
          {GYM_MIN_PLATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-pill${inv.minPlateKg === opt.value ? " active" : ""}`}
              aria-pressed={inv.minPlateKg === opt.value}
              onClick={() => update({ minPlateKg: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function BiomechanicsProfileSettings({ accountId }: { accountId: string }) {
  const [profile, setProfile] = useState<BiomechanicsProfile>(() => BiomechanicsProfileStore.read(undefined, accountId));
  const [shoulderInput, setShoulderInput] = useState(() =>
    profile.biacromialCm !== null ? String(profile.biacromialCm) : "",
  );
  const grip = BiomechanicsProfileStore.optimalBenchGripCm(profile.biacromialCm);

  const toggleLongLevers = (checked: boolean) => {
    setProfile((prev) => BiomechanicsProfileStore.save({ ...prev, longLevers: checked }, undefined, accountId));
  };

  const updateShoulder = (raw: string) => {
    setShoulderInput(raw);
    const cleaned = raw.trim().replace(",", ".");
    const parsed = cleaned === "" ? null : Number(cleaned);
    if (parsed === null || (Number.isFinite(parsed) && parsed >= 30 && parsed <= 60)) {
      setProfile((prev) => BiomechanicsProfileStore.save({ ...prev, biacromialCm: parsed }, undefined, accountId));
    }
  };

  return (
    <section className="settings-inventory" aria-label="Антропометрия и длинные рычаги">
      <label className="settings-safety-toggle" style={{ marginTop: 0 }}>
        <input
          type="checkbox"
          checked={profile.longLevers}
          onChange={(e) => toggleLongLevers(e.target.checked)}
        />
        <span>
          <b>Длинные рычаги (высокий рост / эктоморф)</b>
          <small>
            Показывает короткую 1-строчную подсказку по технике в базовых упражнениях (хват, углы, пауза в растяжении).
          </small>
        </span>
      </label>
      {profile.longLevers ? (
        <div className="settings-inventory-row">
          <label>
            Ширина плеч по акромионам, см (опционально)
            <input
              type="number"
              min="30"
              max="60"
              step="0.5"
              inputMode="decimal"
              placeholder="Например, 40"
              value={shoulderInput}
              onChange={(e) => updateShoulder(e.target.value)}
            />
          </label>
          <small className="tiny">
            {grip
              ? `Оптимальный хват в жиме лёжа (1,4–1,5×): ${grip.min}–${grip.max} см между указательными пальцами.`
              : "Если указать ширину плеч (30–60 см), рассчитаю безопасный хват для жима лёжа в см."}
          </small>
        </div>
      ) : null}
    </section>
  );
}

function AvoidedExercisesManager({ accountId }: { accountId: string }) {
  const [items, setItems] = useState(() => new ExerciseAvoidStore(accountId).read());
  if (!items.length) return null;
  return (
    <div className="avoided-manager">
      <div className="avoided-manager-head">
        <Shield size={14} aria-hidden="true" />
        <b>Скрытые упражнения ({items.length})</b>
      </div>
      <ul className="avoided-list">
        {items.map((item) => {
          const ex = exerciseById(item.exerciseId);
          return (
            <li key={item.exerciseId}>
              <div>
                <b>{ex?.name ?? item.exerciseId}</b>
                <small>
                  {AVOID_REASON_LABELS[item.reason]} · с {item.addedAt}
                </small>
              </div>
              <button
                type="button"
                className="avoided-restore-btn"
                onClick={() => setItems(new ExerciseAvoidStore(accountId).remove(item.exerciseId))}
              >
                <RotateCcw size={13} aria-hidden="true" />
                <span>Вернуть</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface AppModalsProps {
  account: AccountProfile;
  onAccountChange: (p: AccountProfile) => void;
  onLogout: () => void;
  modal: AppModalId;
  setModal: Dispatch<SetStateAction<AppModalId>>;
  importBusy: boolean;
  setImportBusy: (busy: boolean) => void;
  draft: Draft | null;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
  workouts: Workout[];
  displayed: Workout[];
  setWorkouts: Dispatch<SetStateAction<Workout[]>>;
  product: ProductData;
  setProduct: Dispatch<SetStateAction<ProductData>>;
  settings: Settings;
  settingsDraft: Settings;
  setSettingsDraft: Dispatch<SetStateAction<Settings>>;
  saving: boolean;
  saveError: string;
  setSaveError: (err: string) => void;
  demo: boolean;
  setDemo: (demo: boolean) => void;
  today: string;
  mapping: "recorded" | "current";
  deload: DeloadPlanRecord | null;
  onApplyDeload: (mode: DeloadMode) => DeloadApplication;
  onCancelDeload: () => void;
  pendingCount: number;
  detail: Workout | null;
  setDetail: Dispatch<SetStateAction<Workout | null>>;
  setJustSaved: Dispatch<SetStateAction<Workout | null>>;
  deleteId: string | null;
  setDeleteId: Dispatch<SetStateAction<string | null>>;
  personalEditor: Exercise | undefined;
  exerciseDetail: string | null;
  setExerciseDetail: Dispatch<SetStateAction<string | null>>;
  conflict: { current: Workout | null } | null;
  setConflict: Dispatch<SetStateAction<{ current: Workout | null } | null>>;
  canEditWorkout: () => boolean;
  renderPicker: () => ReactNode;
  onNavigate: (view: ProductView) => void;
  onOpenSettings: () => void;
  onSaveSettings: () => Promise<void>;
  onDeleteWorkout: () => Promise<void>;
  onEditWorkout: (w: Workout) => void;
  onStartWorkout: (ids?: string[], name?: string, template?: Workout, retro?: boolean) => void;
  onAddExercise: (id: string) => void;
  onCreateProgramFromWorkout: (routine: Routine) => void;
  onExportHistory: () => Promise<void>;
  onExportDraft: () => void;
  onReload: () => Promise<void>;
  onImportCompleteState: (record: ImportRecord | null, noopKind: "import" | "restore" | null, runs: { last: { runId: string; at: string; total: number; activeCount: number } | null; pending: { runId: string; total: number } | null }) => void;
  onToast: (text: string) => void;
}

export function AppModals({
  account,
  onAccountChange,
  onLogout,
  modal,
  setModal,
  importBusy,
  setImportBusy,
  draft,
  setDraft,
  workouts,
  displayed,
  setWorkouts,
  product,
  setProduct,
  settings,
  settingsDraft,
  setSettingsDraft,
  saving,
  saveError,
  setSaveError,
  demo,
  setDemo,
  today,
  mapping,
  deload,
  onApplyDeload,
  onCancelDeload,
  pendingCount,
  detail,
  setDetail,
  setJustSaved,
  deleteId,
  setDeleteId,
  personalEditor,
  exerciseDetail,
  setExerciseDetail,
  conflict,
  setConflict,
  canEditWorkout,
  renderPicker,
  onNavigate,
  onOpenSettings,
  onSaveSettings,
  onDeleteWorkout,
  onEditWorkout,
  onStartWorkout,
  onAddExercise,
  onCreateProgramFromWorkout,
  onExportHistory,
  onExportDraft,
  onReload,
  onImportCompleteState,
  onToast,
}: AppModalsProps) {
  return (
    <>
      {modal === "picker" ? (
        <Modal title="Добавить упражнения" onClose={() => setModal(null)} wide>
          {renderPicker()}
          <div className="modal-actions">
            <span className="muted">
              {draft?.workout.exercises.length ?? 0} упражнений в тренировке
            </span>
            <button
              className="button primary"
              onClick={() => {
                setModal(null);
                onNavigate("workout");
              }}
            >
              Готово
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "settings" ? (
        <Modal title="Мои недельные ориентиры" onClose={() => setModal(null)}>
          <p className="modal-intro">
            Твои недельные ориентиры по прямым подходам. Исходные числа — настройки приложения, не
            универсальные нормы или персональная программа.
          </p>
          <div className="goal-settings">
            {MUSCLES.map((m) => (
              <label key={m.id}>
                <span>{m.name}</span>
                <input
                  aria-label={`Недельная цель: ${m.name}`}
                  type="number"
                  min="1"
                  max="40"
                  value={settingsDraft.goals[m.id]}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      goals: { ...s.goals, [m.id]: Number(e.target.value) },
                    }))
                  }
                />
                <span className="tiny">подх.</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary full-width"
            style={{ marginTop: 16 }}
            onClick={() => {
              try {
                const goals = TrainingProgram.programV2Goals();
                setSettingsDraft((s) => ({
                  ...s,
                  goals: { ...s.goals, ...goals },
                }));
              } catch (err) {
                setSaveError(err instanceof Error ? err.message : "Ошибка расчёта");
              }
            }}
          >
            <Sparkles size={17} />
            Взять ориентиры из программы v2
          </button>
          <p className="tiny" style={{ marginTop: 8 }}>
            Числа — недельные рабочие подходы, которые программа v2 планирует сама; жимы в них
            считаются и подходами на трицепс.
          </p>
          <div className="settings-zone">
            <TimeZoneField
              label="Часовой пояс календаря"
              value={settingsDraft.timeZone ?? browserTimeZone()}
              onChange={(zone) => setSettingsDraft((v) => ({ ...v, timeZone: zone }))}
              required={false}
            />
            <small className="tiny">Даты прошлых тренировок не сдвигаются.</small>
          </div>
          <div className="settings-bottom">
            <label>
              Оборудование
              <Select
                value={settingsDraft.equipment}
                onChange={(v) => setSettingsDraft((s) => ({ ...s, equipment: v as Equipment }))}
                options={EQ_OPTIONS}
              />
            </label>
            <label>
              Отдых, секунды
              <input
                type="number"
                min="15"
                max="600"
                step="15"
                value={settingsDraft.restSeconds}
                onChange={(e) =>
                  setSettingsDraft((s) => ({ ...s, restSeconds: Number(e.target.value) }))
                }
              />
            </label>
          </div>
          <GymInventorySettings />
          <BiomechanicsProfileSettings accountId={account.id} />
          <label className="settings-safety-toggle">
            <input
              type="checkbox"
              checked={!!settingsDraft.minorMode}
              onChange={(e) =>
                setSettingsDraft((s) => ({
                  ...s,
                  minorMode: e.target.checked ? true : undefined,
                }))
              }
            />
            <span>
              <b>Безопасный режим (до 18 лет)</b>
              <small>
                Отключает автоматические тяжёлые синглы 95–97,5 % и автоэскалацию 1ПМ в DUP; фокус на технике и контроле наставника (рекомендации AAP).
              </small>
            </span>
          </label>
          <AvoidedExercisesManager accountId={account.id} />
          {saveError ? (
            <div className="inline-error" role="alert">
              {saveError}
              {settings.revision !== settingsDraft.revision ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setSettingsDraft(structuredClone(settings));
                    setSaveError("");
                  }}
                >
                  Загрузить актуальные настройки
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="modal-actions">
            <button
              className="text-button"
              onClick={() =>
                setSettingsDraft({
                  ...structuredClone(DEFAULT_SETTINGS),
                  revision: settingsDraft.revision,
                  timeZone: browserTimeZone(),
                })
              }
            >
              Сбросить к исходным
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={() => void onSaveSettings()}
            >
              {saving ? "Сохраняем…" : "Сохранить ориентиры"}
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "method" ? (
        <Modal title="Как считаем записанную работу" onClose={() => setModal(null)}>
          <div className="method-content">
            <p>
              Карта показывает <b>распределение записанных подходов</b>, не силу, рост или
              восстановление мышц.
            </p>
            <div className="formula-card">
              <b>1 выполненный рабочий подход</b>
              <span>как отдельная запись участия движителя</span>
            </div>
            <ul>
              <li>
                Разминка записывается и входит в общий тоннаж и количество выполненных подходов. Её
                участие в мышцах показывается отдельно; недельные ориентиры считают рабочие подходы.
                Невыполненные подходы исключаются.
              </li>
              <li>
                Роли движителя, помощника и стабилизатора разделены. Помощь не прибавляется к прямым
                целям; стабилизация не заполняет ориентир. В инструменте «Объём по мышцам» отдельно
                показана дробная оценка: прямые + 0,5 × помощь, с указанным периодом и ограничениями.
              </li>
              <li>RIR хранится отдельно. Можно включить фильтр ≤3, без коэффициентов стимула.</li>
              <li>
                Покрытие — среднее min(прямые подходы / мой ориентир, 1) по 10 зонам. 100% означает
                выполнение настроек, не физиологический баланс.
              </li>
              <li>
                Один подход может иметь нескольких движителей. Внутри зоны он считается один раз, без
                деления «стимула» до суммы 1.
              </li>
            </ul>
            <p>
              Каталог содержит анатомические роли и источники с ограничениями. ЭМГ и мышечный рост —
              разные измерения. Проверяемая разметка не обещает 100% точности для любого человека и
              любой техники.
            </p>
            <p>
              <b>Внешний объём:</b> вес × число гантелей × повторы × явно записанные стороны. Масса
              тела, тренажёры и старые неопределённые веса не суммируются в этот показатель.
            </p>
            <p>
              <b>Расчётный 1ПМ записанного веса:</b> формула Эпли, версия 1, для разрешённых
              упражнений и 1–12 повторений. У гантелей — на одну гантель. Для массы тела, помощи,
              тренажёров и неизвестных старых правил веса он отключён. Это оценка внутри одного
              варианта упражнения.
            </p>
            <p className="tiny">
              Методика 2 применяется к счётчику подходов явно. История хранит версии каталога;
              исходные записи не меняются при пересчёте. Расчёт подходов по методике 1 доступен в
              старых тренировках.
            </p>
          </div>
        </Modal>
      ) : null}

      {detail ? (
        <Suspense fallback={<ModalFallback />}>
          <WorkoutDetailModal
            detail={detail}
            history={displayed}
            settings={settings}
            account={account}
            demo={demo}
            onClose={() => setDetail(null)}
            onDelete={setDeleteId}
            onCreateProgram={(workout) => {
              onCreateProgramFromWorkout(TrainingProgram.fromWorkout(workout));
              setDetail(null);
              onNavigate("programs");
            }}
            onRepeat={(workout) => {
              const copy = repeatWorkout(workout, settings.timeZone);
              setDetail(null);
              onStartWorkout([], undefined, copy);
            }}
            onEdit={onEditWorkout}
            onHealthSaved={(saved) => {
              setDetail(saved);
              setWorkouts((ws) => ws.map((w) => (w.id === saved.id ? saved : w)));
              setJustSaved((w) => (w?.id === saved.id ? saved : w));
              onToast("Показатели часов сохранены");
            }}
          />
        </Suspense>
      ) : null}

      {deleteId ? (
        <Modal title="Удалить тренировку?" onClose={() => setDeleteId(null)}>
          <p className="modal-intro">
            Подходы исчезнут из истории и расчётов. Это действие нельзя отменить.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleteId(null)}>
              Оставить
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={() => void onDeleteWorkout()}
            >
              {saving ? "Удаляем…" : "Удалить"}
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "rest_notifications" && (
        <Modal title="Уведомления отдыха" onClose={() => setModal(null)}>
          <Suspense fallback={<ModalFallback />}>
            <RestNotificationSettings />
          </Suspense>
        </Modal>
      )}

      {modal === "backup" && (
        <Modal title="Резервная копия" onClose={() => setModal(null)}>
          <div className="backup-tools">
            <p>
              В одном файле: тренировки, программы, личные упражнения, избранное, вес, цели и
              настройки. Пароли и сессии в копию не входят.
            </p>
            <button className="button primary" onClick={() => void onExportHistory()}>
              <Download size={18} />
              Скачать полную копию
            </button>
            <button className="button secondary" onClick={() => setModal("restore")}>
              Восстановить из файла
            </button>
            <p className="tiny">
              Перед восстановлением можно просмотреть содержимое и выбрать, как поступить с разными
              замерами за один день.
            </p>
          </div>
        </Modal>
      )}

      {modal === "import" || modal === "restore" ? (
        <Modal
          title={modal === "restore" ? "Восстановление из копии" : "Импорт истории"}
          wide
          onClose={() => {
            if (importBusy) return false;
            setModal(null);
          }}
        >
          <Suspense fallback={<p>Открываем импорт…</p>}>
            <HistoryImporter
              mode={modal === "restore" ? "restore" : "import"}
              existing={{
                workouts,
                routines: product.routines,
                customExercises: product.customExercises,
                favorites: product.favorites,
              }}
              onClose={() => {
                setModal(null);
                onNavigate("history");
              }}
              timeZone={settings.timeZone ?? browserTimeZone()}
              onBusy={setImportBusy}
              onComplete={async (result) => {
                if (result.settings) {
                  const latest = await api<{ settings: Settings }>("/api/data");
                  await api("/api/settings", "PUT", {
                    ...result.settings,
                    revision: latest.settings.revision ?? 0,
                  });
                }
                if (result.profile) {
                  const latest = await api<{ profile: AccountProfile }>("/api/auth/session");
                  const restored = await api<{ profile: AccountProfile }>(
                    "/api/auth/profile",
                    "PUT",
                    { ...result.profile, revision: latest.profile.revision },
                  );
                  onAccountChange(restored.profile);
                }
                await onReload();
                if (result.theme) applyTheme(result.theme as ThemeId);
                if (modal !== "restore") {
                  setModal(null);
                  onNavigate("history");
                }
                setDemo(false);
                if (result.addedIds?.length) {
                  const record: ImportRecord = {
                    at: new Date().toISOString(),
                    ids: result.addedIds,
                    imported: result.imported - (result.replaced ?? 0),
                    replaced: result.replaced ?? 0,
                    kept: result.kept ?? 0,
                    kind: modal === "restore" ? "restore" : "import",
                  };
                  const currentRuns = await importService
                    .runs()
                    .catch(() => ({ runs: [], pending: [] }));
                  onImportCompleteState(record, null, {
                    last: currentRuns.runs[0] ?? null,
                    pending: currentRuns.pending?.[0]
                      ? { runId: currentRuns.pending[0].runId, total: currentRuns.pending[0].total }
                      : null,
                  });
                } else {
                  onImportCompleteState(null, modal === "restore" ? "restore" : "import", {
                    last: null,
                    pending: null,
                  });
                }
                const added = result.imported - (result.replaced ?? 0);
                onToast(
                  `Импорт завершён: добавлено ${added}` +
                    (result.replaced ? `, заменено ${result.replaced}` : "") +
                    `, пропущено ${result.skipped - (result.kept ?? 0)}` +
                    (result.kept ? `, твои правки сохранены: ${result.kept}` : "") +
                    (result.weightCount !== undefined ? `; замеров веса: ${result.weightCount}` : ""),
                );
              }}
            />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "personal" ? (
        <Modal
          title={personalEditor ? "Редактировать своё упражнение" : "Своё упражнение"}
          onClose={() => setModal(null)}
        >
          <Suspense fallback={<p>Открываем редактор…</p>}>
            <PersonalExerciseEditor
              accountId={account.id}
              exercise={personalEditor}
              onDeleted={(id) => {
                setProduct((p) => ({
                  ...p,
                  customExercises: p.customExercises.filter((e) => e.id !== id),
                  favorites: p.favorites.filter((e) => e !== id),
                }));
                setModal(null);
                onToast("Упражнение убрано из каталога; история сохранена");
              }}
              onSaved={(exercise) => {
                exerciseCatalog.register([exercise]);
                setProduct((p) => {
                  const oldIds = p.customExercises
                    .filter((e) => e.custom?.familyId === exercise.custom?.familyId)
                    .map((e) => e.id);
                  const wasFavorite = p.favorites.some((id) => oldIds.includes(id));
                  return {
                    ...p,
                    customExercises: [
                      exercise,
                      ...p.customExercises.filter((e) => !oldIds.includes(e.id)),
                    ],
                    favorites: [
                      ...p.favorites.filter((id) => !oldIds.includes(id)),
                      ...(wasFavorite ? [exercise.id] : []),
                    ],
                  };
                });
                setModal(null);
                onToast("Упражнение сохранено в личном каталоге");
              }}
            />
          </Suspense>
        </Modal>
      ) : null}

      {exerciseDetail ? (
        <Modal
          title={exerciseById(exerciseDetail)!.name}
          onClose={() => setExerciseDetail(null)}
        >
          <ExerciseInfo
            exercise={exerciseById(exerciseDetail)!}
            disabled={!!draft?.workout.exercises.some((e) => e.exerciseId === exerciseDetail)}
            onAdd={() => {
              onAddExercise(exerciseDetail);
              setExerciseDetail(null);
              onNavigate("workout");
            }}
          />
        </Modal>
      ) : null}

      {modal === "profile" ? (
        <Modal title="Мой профиль" onClose={() => setModal(null)}>
          <Suspense fallback={<ModalFallback />}>
            <AccountProfileForm
              account={account}
              hasDraft={!!draft}
              queued={pendingCount}
              onChange={(p) => {
                onAccountChange(p);
                void onReload();
              }}
              onLogout={onLogout}
            />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "plate" ? (
        <Modal title="Калькулятор блинов" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <PlateCalculator onClose={() => setModal(null)} />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "orm" ? (
        <Modal title="Калькулятор 1ПМ" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <OneRepMaxCalculator onClose={() => setModal(null)} />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "machines" && (
        <Modal title="Мои тренажёры" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <MachineManager
              machines={product.machines ?? []}
              onSave={async (machine) => {
                const result = await productService.saveMachine(machine);
                setProduct((p) => ({
                  ...p,
                  machines: [
                    result.machine,
                    ...(p.machines ?? []).filter((m) => m.id !== result.machine.id),
                  ],
                }));
              }}
              onArchive={async (machine) => {
                await productService.archiveMachine(machine);
                setProduct((p) => ({
                  ...p,
                  machines: (p.machines ?? []).filter((m) => m.id !== machine.id),
                }));
              }}
            />
          </Suspense>
        </Modal>
      )}

      {modal === "tools" && (
        <Modal title="Инструменты и настройки" onClose={() => setModal(null)}>
          <ToolsHub
            onChoose={(id) => {
              if (id === "settings") onOpenSettings();
              else if (id === "supplements") {
                setModal(null);
                onNavigate("supplements");
              } else setModal(id);
            }}
          />
        </Modal>
      )}

      {modal === "bodyweight" ? (
        <Modal title="Контроль массы тела" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <BodyweightModal
              accountId={account.id}
              timeZone={settings.timeZone}
              onClose={() => setModal(null)}
            />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "deload" ? (
        <Modal title="Настройка разгрузочной недели" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <DeloadModal
              workouts={workouts}
              timeZone={settings.timeZone}
              plan={deload}
              hasDraft={!!draft}
              onApplyDeload={onApplyDeload}
              onCancelDeload={onCancelDeload}
              onClose={() => setModal(null)}
            />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "warmup" ? (
        <Modal title="Разминочная лесенка (OpenGym)" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <WarmupModal onClose={() => setModal(null)} />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "ios_install" ? (
        <Modal title="Установить на iPhone" onClose={() => setModal(null)}>
          <Suspense fallback={<ModalFallback />}>
            <IosInstallPrompt onClose={() => setModal(null)} />
          </Suspense>
        </Modal>
      ) : null}

      {modal === "rp_volume" ? (
        <Modal title="Ориентиры недельного объёма" onClose={() => setModal(null)} wide>
          <Suspense fallback={<ModalFallback />}>
            <VolumeLandmarksModal
              workouts={displayed}
              today={today}
              mapping={mapping}
              timeZone={settings.timeZone}
            />
          </Suspense>
        </Modal>
      ) : null}

      {conflict && draft ? (
        <Modal title={WorkoutConflict.title(conflict.current)} onClose={() => setConflict(null)}>
          <dl className="conflict-compare">
            {WorkoutConflict.summary(draft.workout, conflict.current).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="conflict-choices">
            <div className="conflict-choice">
              <button
                className="button primary"
                onClick={() => {
                  if (!canEditWorkout()) return;
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          workout: new WorkoutSession(d.workout).separateCopy(),
                          editing: false,
                          manualDuration: true,
                        }
                      : null,
                  );
                  const stale = draft.workout.id;
                  setWorkouts((ws) =>
                    conflict.current
                      ? [conflict.current, ...ws.filter((w) => w.id !== conflict.current!.id)].sort(
                          (a, b) => b.date.localeCompare(a.date),
                        )
                      : ws.filter((w) => w.id !== stale),
                  );
                  setConflict(null);
                  setSaveError("");
                  onToast(WorkoutConflict.COPY_READY);
                }}
              >
                {WorkoutConflict.SAVE_COPY.label}
              </button>
              <small>
                {(conflict.current ? WorkoutConflict.SAVE_COPY : WorkoutConflict.SAVE_COPY_DELETED).effect}
              </small>
            </div>
            {conflict.current ? (
              <div className="conflict-choice">
                <button
                  className="button secondary"
                  onClick={() => {
                    if (!canEditWorkout()) return;
                    const current = conflict.current!;
                    setWorkouts((ws) => [current, ...ws.filter((w) => w.id !== current.id)]);
                    setDraft(newDraft(structuredClone(current), true));
                    setConflict(null);
                    setSaveError("");
                  }}
                >
                  {WorkoutConflict.KEEP_SAVED.label}
                </button>
                <small>{WorkoutConflict.KEEP_SAVED.effect}</small>
              </div>
            ) : null}
            <div className="conflict-choice">
              <button className="text-button" onClick={onExportDraft}>
                <Download size={16} />
                {WorkoutConflict.DOWNLOAD.label}
              </button>
              <small>{WorkoutConflict.DOWNLOAD.effect}</small>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
