import type { ReactNode } from 'react'
export function Tip({ text }: { text: string }) {
  return <span className="tip" tabIndex={0} role="note" aria-label={text}>?<span className="tipbox" role="tooltip">{text}</span></span>
}
export function Field({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return <label className="field"><span className="flabel">{label}{tip && <Tip text={tip} />}</span>{children}</label>
}
