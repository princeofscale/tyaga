import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Запас на случай, если animationend не придёт (вкладка в фоне, анимации отключены стилями). */
const EXIT_FALLBACK_MS = 260;

export default function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose); callback.current = onClose;
  const [closing, setClosing] = useState(false);
  const finished = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => { window.clearTimeout(timer.current); if (dialog.open) dialog.close(); };
  }, []);
  /** Родитель снимает окно с экрана только после анимации выхода: один раз, как бы ни закрыли. */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    callback.current();
  }, []);
  const requestClose = useCallback(() => {
    if (finished.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    setClosing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(finish, EXIT_FALLBACK_MS);
  }, [finish]);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${closing ? 'closing' : ''}`} aria-label={title}
    onCancel={e => { e.preventDefault(); requestClose(); }}
    onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    onAnimationEnd={e => { if (closing && e.target === e.currentTarget) finish(); }}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={requestClose} aria-label="Закрыть окно"><X size={20} /></button></div>
    {children}
  </dialog>;
}
