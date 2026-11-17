import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; resetKey: string };
type State = { failed: boolean; key: string };

/** Падение одной вкладки не гасит приложение: навигация и меню аккаунта (в т. ч. «Выйти из аккаунта») остаются. */
export default class TabErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Другая вкладка — новая попытка.
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Вкладка не открылась", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel tab-error" role="alert">
        <h2>Не удалось открыть вкладку</h2>
        <p>Остальные вкладки работают, данные не потеряны. Попробуй ещё раз или открой другую вкладку.</p>
        <div className="tab-error-actions">
          <button type="button" className="button secondary" onClick={() => this.setState({ failed: false })}>
            Попробовать снова
          </button>
        </div>
      </section>
    );
  }
}
