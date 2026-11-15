import { useState } from "react";
import { Download } from "lucide-react";
import Modal from "./Modal";

/**
 * Код восстановления показывается один раз и нигде не хранится открытым текстом (на сервере — только хэш).
 * Закрыть окно можно только после явного «Я сохранил код»: иначе потерянный код — потерянный доступ.
 */
export default function RecoveryCodeModal({ code, intro, onClose }: { code: string; intro: string; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [nudge, setNudge] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Тяга — код восстановления\n${code}\nХрани отдельно от пароля.\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "tyaga-recovery.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal
      title="Код восстановления"
      onClose={() => {
        if (confirmed) {
          onClose();
          return undefined;
        }
        setNudge(true);
        return false;
      }}
    >
      <p className="modal-intro">{intro}</p>
      <code className="recovery-code">{code}</code>
      <label className="recovery-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>Я сохранил код</span>
      </label>
      {nudge && !confirmed ? (
        <p className="form-error" role="alert">
          Сначала сохрани код и отметь «Я сохранил код». Потом окно закроется.
        </p>
      ) : null}
      <div className="modal-actions">
        <button className="button secondary" onClick={download}>
          <Download size={16} />
          Скачать код
        </button>
        <button className="button primary" disabled={!confirmed} onClick={onClose}>
          Код сохранён
        </button>
      </div>
    </Modal>
  );
}
