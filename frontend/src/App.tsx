import { useCallback, useState } from "react";
import RunsView from "./components/RunsView";
import ExperimentsView from "./components/ExperimentsView";
import RunSetsView from "./components/RunSetsView";
import SavedCommandsView from "./components/SavedCommandsView";
import ImprovementsView from "./components/ImprovementsView";

type Tab = "runs" | "run-sets" | "experiments" | "commands" | "improvements";

export default function App() {
  const [tab, setTab] = useState<Tab>("runs");
  // When a node's command name is clicked, jump to the Saved commands tab and
  // open that command.
  const [openCommandId, setOpenCommandId] = useState<string | null>(null);
  // The run-sets folder currently open in the Run sets tab. Lifted here so a run
  // set created from the Runs tab lands in the folder scope that's open.
  const [runSetFolderId, setRunSetFolderId] = useState<string | null>(null);

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
          <button
            className={tab === "improvements" ? "tab active" : "tab"}
            onClick={() => setTab("improvements")}
          >
            Improvements
          </button>
        </nav>
      </header>

      {tab === "runs" && <RunsView runSetFolderId={runSetFolderId} />}
      {tab === "run-sets" && (
        <RunSetsView folderId={runSetFolderId} setFolderId={setRunSetFolderId} />
      )}
      {tab === "experiments" && <ExperimentsView onOpenCommand={openCommand} />}
      {tab === "commands" && (
        <SavedCommandsView
          openCommandId={openCommandId}
          onConsumedOpen={() => setOpenCommandId(null)}
        />
      )}
      {tab === "improvements" && <ImprovementsView />}
    </div>
  );
}
