import { useCallback, useState } from "react";
import RunsView from "./components/RunsView";
import ExperimentsView from "./components/ExperimentsView";
import RunSetsView from "./components/RunSetsView";
import SavedCommandsView from "./components/SavedCommandsView";

type Tab = "runs" | "run-sets" | "experiments" | "commands";

export default function App() {
  const [tab, setTab] = useState<Tab>("runs");
  // When a node's command name is clicked, jump to the Saved commands tab and
  // open that command.
  const [openCommandId, setOpenCommandId] = useState<string | null>(null);

  const openCommand = useCallback((commandId: string) => {
    setOpenCommandId(commandId);
    setTab("commands");
  }, []);

  return (
    <div className="page">
      <header>
        <h1>Experiment Tracker</h1>
        <nav className="tabs">
          <button className={tab === "runs" ? "tab active" : "tab"} onClick={() => setTab("runs")}>
            Runs
          </button>
          <button className={tab === "run-sets" ? "tab active" : "tab"} onClick={() => setTab("run-sets")}>
            Run sets
          </button>
          <button
            className={tab === "experiments" ? "tab active" : "tab"}
            onClick={() => setTab("experiments")}
          >
            Experiments
          </button>
          <button
            className={tab === "commands" ? "tab active" : "tab"}
            onClick={() => setTab("commands")}
          >
            Saved commands
          </button>
        </nav>
      </header>

      {tab === "runs" && <RunsView />}
      {tab === "run-sets" && <RunSetsView />}
      {tab === "experiments" && <ExperimentsView onOpenCommand={openCommand} />}
      {tab === "commands" && (
        <SavedCommandsView
          openCommandId={openCommandId}
          onConsumedOpen={() => setOpenCommandId(null)}
        />
      )}
    </div>
  );
}
