import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/react'

interface TableOfContentsProps {
  editor: Editor | null
}

interface HeadingItem {
  level: number
  text: string
  id: string
}


const TableOfContents = ({ editor }: TableOfContentsProps) => {
  const [headings, setHeadings] = useState<HeadingItem[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!editor) return

    const updateHeadings = () => {
      const items: HeadingItem[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name.startsWith('heading')) {
          const level = node.attrs.level || 1
          const headingText = node.textContent || ''

          // Create slug from heading text (same logic as CustomHeading in DynamicCanva)
          const slug = headingText
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
            .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens

          const id = slug ? `heading-${slug}` : `heading-${Math.random().toString(36).substr(2, 9)}`

          items.push({
            level,
            text: node.textContent,
            id,
          })
        }
      })
      setHeadings(items)
    }

    editor.on('update', updateHeadings)
    updateHeadings()

    return () => {
      editor.off('update', updateHeadings)
    }
  }, [editor])

  if (headings.length === 0) return null

  // Indent relative to the page's own top heading level, so a page that starts
  // at h2 or h3 is not pushed in for no reason. Two steps of nesting at most.
  const minLevel = Math.min(...headings.map((h) => h.level))

  return (
    <div className="toc w-full h-fit">
      <ul className="toc-list">
        {headings.map((heading, index) => {
          const depth = Math.min(heading.level - minLevel, 2)
          return (
            <li key={index} className="toc-item">
              <a
                className={`toc-link toc-link-depth-${depth}`}
                href={`#${heading.id}`}
                style={{ paddingInlineStart: `${0.875 + depth * 0.75}rem` }}
              >
                {heading.text}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default TableOfContents
