import { Fragment, useRef, useState, type ReactNode } from "react"
import { Textarea, Modal, Stack, TextInput, Group, Button, Anchor, type TextareaProps } from "@mantine/core"

// Matches [label](url) markdown links (any url) OR bare http(s)/www URLs.
const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|((?:https?:\/\/|www\.)[^\s)]+)/g

// Ensure a link has a scheme so the browser treats it as absolute, not a relative path.
const toHref = (url: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`)

/** Render free text with markdown-style [label](url) links and bare URLs as anchors. */
export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  const re = new RegExp(TOKEN)
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const url = m[2] ?? m[3]
    const label = m[1] ?? m[3]
    nodes.push(
      <Anchor key={m.index} href={toHref(url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {label}
      </Anchor>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>
}

/**
 * A Textarea that supports inserting a hyperlink via ⌘K / Ctrl+K. The current
 * selection (if any) becomes the link text; a small modal collects the URL and
 * inserts a `[text](url)` markdown link, which RichText renders as an anchor.
 * String-based value/onChange (not event-based) so the insert can rewrite text.
 */
export function LinkTextarea({
  value,
  onChange,
  ...props
}: { value: string; onChange: (v: string) => void } & Omit<TextareaProps, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null)
  const [label, setLabel] = useState("")
  const [url, setUrl] = useState("")

  const openLink = () => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    setSel({ start, end })
    setLabel(value.slice(start, end))
    setUrl("")
  }

  const insert = () => {
    if (!sel || !url.trim()) return
    const text = label.trim() || url.trim()
    const md = `[${text}](${url.trim()})`
    onChange(value.slice(0, sel.start) + md + value.slice(sel.end))
    setSel(null)
  }

  return (
    <>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault()
            openLink()
          }
        }}
        {...props}
      />
      <Modal opened={sel !== null} onClose={() => setSel(null)} title="Insert link" centered size="sm" zIndex={3000}>
        <Stack gap="sm">
          <TextInput label="Text" value={label} onChange={(e) => setLabel(e.currentTarget.value)} data-autofocus />
          <TextInput
            label="URL"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && insert()}
          />
          <Group justify="flex-end">
            <Button variant="default" size="xs" onClick={() => setSel(null)}>Cancel</Button>
            <Button size="xs" onClick={insert} disabled={!url.trim()}>Insert</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
