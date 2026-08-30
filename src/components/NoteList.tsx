import { useState } from 'react'
import type { Note } from '../types'
import { NOTE_ICON, NOTE_LABEL, sortNotes } from '../lib/trip'

/** Lines shown while a note is collapsed (FR-NOTE-8). */
const CLAMP_LINES = 3

function NoteItem({ note, collapsible }: { note: Note; collapsible: boolean }) {
  const [expanded, setExpanded] = useState(false)
  // Rough guess from line count and length. It only has to catch overflow.
  const longish =
    note.text.split('\n').length > CLAMP_LINES || note.text.length > 110
  const clamped = collapsible && longish && !expanded

  return (
    <li className={`note note--${note.kind}`}>
      <span className="note__icon" aria-hidden="true">{NOTE_ICON[note.kind]}</span>
      <div className="note__body">
        <span className="sr-only">{NOTE_LABEL[note.kind]}: </span>
        {/* Rendered as plain text only (FR-NOTE-6). Newlines handled in CSS (FR-NOTE-5). */}
        <p className={clamped ? 'note__text note__text--clamped' : 'note__text'}>
          {note.text}
        </p>
        {collapsible && longish && (
          <button
            type="button"
            className="note__toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </li>
  )
}

interface Props {
  notes?: Note[]
  collapsible?: boolean
}

/** Renders nothing at all when there are no notes (FR-NOTE-7). */
export default function NoteList({ notes, collapsible = false }: Props) {
  if (!notes?.length) return null
  return (
    <ul className="notes">
      {sortNotes(notes).map((note, i) => (
        <NoteItem key={`${note.kind}-${i}`} note={note} collapsible={collapsible} />
      ))}
    </ul>
  )
}
