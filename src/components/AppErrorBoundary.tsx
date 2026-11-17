import { Component, type ErrorInfo, type ReactNode } from "react";
import { signOutAccount } from "../services/signOut";

type Props = { children: ReactNode; onLogout: () => void };
type State = { failed: boolean; busy: boolean; error: string };

/**
 * Корневая граница: ловит сбой самого приложения (то, что не поймала граница вкладки), чтобы экран не оставался пустым.
 * Предлагает повторить и выйти из аккаунта — выход не требует состояния приложения.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, busy: false, error: "" };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Приложение не открылось", error, info.componentStack);
  }

  private signOut = async () => {
    this.setState({ busy: true, error: "" });
    try {
      await signOutAccount(this.props.onLogout);
    } catch (e) {
      this.setState({ busy: false, error: e instanceof Error ? e.message : "Не удалось выйти" });
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error">
        <section className="panel tab-error app-error-panel" role="alert">
          <h1>Не удалось открыть приложение</h1>
          <p>Данные, сохранённые в аккаунте, не потеряны. Попробуй ещё раз; если не помогает — выйди и войди снова. При выходе несохранённая тренировка на этом устройстве пропадёт.</p>
          {this.state.error ? <p className="error-banner">{this.state.error}</p> : null}
          <div className="tab-error-actions">
            <button type="button" className="button primary" disabled={this.state.busy} onClick={() => this.setState({ failed: false, error: "" })}>
              Попробовать снова
            </button>
            <button type="button" className="button secondary" disabled={this.state.busy} onClick={() => void this.signOut()}>
              Выйти из аккаунта
            </button>
          </div>
        </section>
      </main>
    );
  }
}
