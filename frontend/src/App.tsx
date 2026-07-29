import { useState } from "react";
import RunsView from "./components/RunsView";
import ExperimentsView from "./components/ExperimentsView";
import RunSetsView from "./components/RunSetsView";

type Tab = "runs" | "run-sets" | "experiments";

export default function App() {
  const [tab, setTab] = useState<Tab>("runs");

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
        </nav>
      </header>

      {tab === "runs" && <RunsView />}
      {tab === "run-sets" && <RunSetsView />}
      {tab === "experiments" && <ExperimentsView />}
    </div>
  );
}
