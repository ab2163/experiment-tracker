import { useCallback, useEffect, useRef, useState } from "react"
import { Tabs, Text, Loader, Center, Stack, Title, Group, Button } from "@mantine/core"
import { EmptyState } from "@shared/omni-ui"
import { TrackerDataProvider, useTracker } from "./lib/data"
import { ConfirmProvider } from "./lib/confirm"
import { useMe, ownedByMe } from "./lib/sharing"
import { seedExamples } from "./lib/seed"
import { RefreshIcon } from "./lib/icons"
import { RunsTab } from "./screens/RunsTab"
import { ExperimentsTab } from "./screens/ExperimentsTab"
import { RunSetsTab } from "./screens/RunSetsTab"
import { CommandsTab } from "./screens/CommandsTab"
import { ImprovementsTab } from "./screens/ImprovementsTab"
import { FlowGraph } from "./screens/FlowGraph"
import { useOmniContext } from "./bridge"

function Shell() {
  const { data, loading, error, reload } = useTracker()
  const me = useMe()
  const [tab, setTab] = useState<string>("runs")
  // When set, the Experiments tab is replaced by the single-experiment flow graph.
  const [flowFor, setFlowFor] = useState<{ id: string; title: string } | null>(null)
  // Cross-tab jump: a command chip on a stage node opens the Commands tab on it.
  const [openCommandId, setOpenCommandId] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const seededRef = useRef(false)
  useOmniContext({ tab, flow: flowFor?.id })

  // First-entry onboarding: a viewer who owns nothing yet gets the "Example"
  // template artifacts cloned into their own space (once). Waits for identity so
  // ownership is known; skips the seeder's own account (which already owns data).
  useEffect(() => {
    if (!data || loading || seededRef.current) return
    if (!me || (!me.id && !me.email)) return
    if (data.templates.experiments.length === 0) return
    const anyMine =
      data.experiments.some((e) => ownedByMe(e.created_by, me)) ||
      data.runSets.some((r) => ownedByMe(r.created_by, me)) ||
      data.commands.some((c) => ownedByMe(c.created_by, me)) ||
      data.folders.some((f) => ownedByMe(f.created_by, me))
    if (anyMine) return
    seededRef.current = true
    setSeeding(true)
    const shorts = new Set(
      [...data.runSets, ...data.templates.runSets].map((r) => r.short_id).filter((x): x is string => !!x),
    )
    seedExamples(data.templates, shorts)
      .then(() => reload())
      .catch(() => { seededRef.current = false })
      .finally(() => setSeeding(false))
  }, [data, loading, me, reload])

  const openCommand = useCallback((id: string) => {
    setFlowFor(null)
    setTab("commands")
    setOpenCommandId(id)
  }, [])

  return (
    <Stack gap={0} h="100vh" style={{ overflow: "hidden" }}>
      <Group px="md" pt="md" pb={4} justify="space-between">
        <Title order={3}>Experiment Tracker</Title>
        <Button
          size="xs"
          variant="default"
          leftSection={<RefreshIcon size={14} />}
          onClick={reload}
          loading={loading}
          title="Reload graph data (does not trigger a WandB sync)"
        >
          Refresh
        </Button>
      </Group>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error ? (
          <EmptyState title="Couldn't load data" description={error} />
        ) : !data ? (
          <Center h="60vh">
            <Stack align="center" gap="xs">
              <Loader />
              <Text c="dimmed" size="sm">Loading graph data…</Text>
            </Stack>
          </Center>
        ) : seeding ? (
          <Center h="60vh">
            <Stack align="center" gap="xs">
              <Loader />
              <Text c="dimmed" size="sm">Setting up your example workspace…</Text>
            </Stack>
          </Center>
        ) : flowFor ? (
          <FlowGraph
            experimentId={flowFor.id}
            experimentTitle={flowFor.title}
            onBack={() => setFlowFor(null)}
            onOpenCommand={openCommand}
          />
        ) : (
          <Tabs
            value={tab}
            onChange={(v) => setTab(v ?? "runs")}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          >
            <Tabs.List px="md">
              <Tabs.Tab value="runs">Runs</Tabs.Tab>
              <Tabs.Tab value="run-sets">Run sets</Tabs.Tab>
              <Tabs.Tab value="experiments">Experiments</Tabs.Tab>
              <Tabs.Tab value="commands">Saved commands</Tabs.Tab>
              <Tabs.Tab value="improvements">Improvements</Tabs.Tab>
            </Tabs.List>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <Tabs.Panel value="runs"><RunsTab /></Tabs.Panel>
              <Tabs.Panel value="run-sets"><RunSetsTab /></Tabs.Panel>
              <Tabs.Panel value="experiments">
                <ExperimentsTab onOpenFlow={(id, title) => setFlowFor({ id, title })} />
              </Tabs.Panel>
              <Tabs.Panel value="commands">
                <CommandsTab openCommandId={openCommandId} onOpened={() => setOpenCommandId(null)} />
              </Tabs.Panel>
              <Tabs.Panel value="improvements"><ImprovementsTab /></Tabs.Panel>
            </div>
          </Tabs>
        )}
      </div>
    </Stack>
  )
}

export function App() {
  return (
    <ConfirmProvider>
      <TrackerDataProvider>
        <Shell />
      </TrackerDataProvider>
    </ConfirmProvider>
  )
}
