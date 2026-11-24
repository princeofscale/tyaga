import { Share2, PlusSquare, CheckCircle2 } from "lucide-react";

export function IosInstallPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div className="ios-install-guide">
      <div className="ios-install-hero">
        <div className="ios-app-icon-preview">
          <img src="/favicon.svg" alt="Тяга" width={64} height={64} />
          <div className="ios-icon-glow" />
        </div>
        <h3>Установи Тягу на экран iPhone</h3>
        <p>
          Приложение открывается на весь экран без адресной строки и работает в спортзале без связи:
          оболочка и каталог кэшируются, а завершённые тренировки и изменения встают в очередь и уходят в облако при возвращении сети.
        </p>
      </div>

      <div className="ios-steps-list">
        <div className="ios-step-item">
          <div className="ios-step-number">1</div>
          <div className="ios-step-content">
            <div className="ios-step-title">
              <span>Нажми кнопку «Поделиться»</span>
              <Share2 size={18} className="text-accent" />
            </div>
            <p className="ios-step-desc">
              Иконка квадрата со стрелкой вверх в нижней панели Safari.
            </p>
          </div>
        </div>

        <div className="ios-step-item">
          <div className="ios-step-number">2</div>
          <div className="ios-step-content">
            <div className="ios-step-title">
              <span>Выбери «На экран «Домой»»</span>
              <PlusSquare size={18} className="text-accent" />
            </div>
            <p className="ios-step-desc">
              Прокрути меню действий вниз до пункта со значком «+».
            </p>
          </div>
        </div>

        <div className="ios-step-item">
          <div className="ios-step-number">3</div>
          <div className="ios-step-content">
            <div className="ios-step-title">
              <span>Нажми «Добавить»</span>
              <CheckCircle2 size={18} className="text-accent" />
            </div>
            <p className="ios-step-desc">
              В правом верхнем углу экрана. Иконка Тяги появится на рабочем столе рядом с другими приложениями.
            </p>
          </div>
        </div>
      </div>

      <div className="ios-install-actions">
        <button type="button" className="button primary full-width" onClick={onClose}>
          Всё понятно
        </button>
      </div>
    </div>
  );
}
