import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { Modal, Text, Group, Button } from "@mantine/core"

// The page runs in a sandboxed iframe (`allow-scripts allow-forms`, no
// `allow-modals`), so window.confirm/alert/prompt are silently blocked — a
// native confirm returns false and the guarded action never runs. This provides
// an in-app confirm() that returns a Promise<boolean> instead.
interface ConfirmOpts {
  message: string
  title?: string
  confirmLabel?: string
  danger?: boolean
}
type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>

const Ctx = createContext<ConfirmFn>(async () => false)
export const useConfirm = () => useContext(Ctx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  )
  const close = (v: boolean) => {
    setState((s) => {
      s?.resolve(v)
      return null
    })
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal opened={!!state} onClose={() => close(false)} title={state?.title ?? "Confirm"} centered>
        <Text size="sm">{state?.message}</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" size="xs" onClick={() => close(false)}>Cancel</Button>
          <Button color={state?.danger === false ? undefined : "red"} size="xs" onClick={() => close(true)}>
            {state?.confirmLabel ?? "Delete"}
          </Button>
        </Group>
      </Modal>
    </Ctx.Provider>
  )
}
