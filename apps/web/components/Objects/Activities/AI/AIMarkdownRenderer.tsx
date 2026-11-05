'use client'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { MarkdownImageLink } from './MarkdownImageLink'

type AIMarkdownRendererProps = {
  content: string
  isStreaming?: boolean
  /**
   * Colour scheme of the surface the answer sits on. The in-activity AI panel
   * and the editor side panel are dark; Atlas is a white panel, where the
   * white text made answers invisible until selected.
   */
  tone?: 'dark' | 'light'
}

const TONES = {
  dark: {
    root: 'prose-invert',
    heading: 'text-white/90',
    body: 'text-white/80',
    strong: 'text-white/90',
    inlineCode: 'bg-white/10 text-purple-300',
    block: 'bg-black/40',
    quote: 'border-purple-500/50 text-white/70',
    link: 'text-purple-400 hover:text-purple-300',
    hr: 'border-white/10',
    thead: 'bg-white/10',
    cell: 'border-white/20',
    th: 'text-white/90',
    cursor: 'bg-purple-400/90',
  },
  light: {
    root: '',
    heading: 'text-gray-900',
    body: 'text-gray-800',
    strong: 'text-gray-900',
    inlineCode: 'bg-gray-100 text-wine-800',
    block: 'bg-gray-50 text-gray-800 border border-gray-200',
    quote: 'border-wine-300 text-gray-600',
    link: 'text-wine-800 hover:text-wine-950',
    hr: 'border-gray-200',
    thead: 'bg-gray-50',
    cell: 'border-gray-200',
    th: 'text-gray-900',
    cursor: 'bg-wine-700',
  },
}

function AIMarkdownRenderer({ content, isStreaming = false, tone = 'dark' }: AIMarkdownRendererProps) {
  const c = TONES[tone]
  return (
    <div className={`ai-markdown-content prose ${c.root} prose-sm max-w-none`}>
      <style jsx global>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .streaming-cursor {
          animation: cursor-blink 0.8s ease-in-out infinite;
        }
      `}</style>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className={`text-lg font-bold ${c.heading} mt-4 mb-2 first:mt-0`}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className={`text-base font-bold ${c.heading} mt-3 mb-2 first:mt-0`}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className={`text-sm font-bold ${c.heading} mt-2 mb-1 first:mt-0`}>{children}</h3>
          ),
          // Paragraph
          p: ({ children }) => (
            <p className={`${c.body} text-sm leading-relaxed mb-2 last:mb-0`}>{children}</p>
          ),
          // Bold and italic
          strong: ({ children }) => (
            <strong className={`font-semibold ${c.strong}`}>{children}</strong>
          ),
          em: ({ children }) => (
            <em className={`italic ${c.body}`}>{children}</em>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className={`list-disc list-inside ${c.body} text-sm mb-2 space-y-1 ms-2`}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className={`list-decimal list-inside ${c.body} text-sm mb-2 space-y-1 ms-2`}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className={c.body}>{children}</li>
          ),
          // Code blocks
          code: ({ className, children, ...props }) => {
            const isInline = !className
            if (isInline) {
              return (
                <code
                  className={`${c.inlineCode} px-1.5 py-0.5 rounded text-xs font-mono`}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code
                className={`${className} block ${c.block} rounded-lg p-3 text-xs font-mono overflow-x-auto my-2`}
                {...props}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className={`${c.block} rounded-lg overflow-x-auto my-2`}>
              {children}
            </pre>
          ),
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className={`border-s-2 ${c.quote} ps-3 my-2 italic`}>
              {children}
            </blockquote>
          ),
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${c.link} underline`}
            >
              {children}
            </a>
          ),
          // Images render as links, never loaded
          img: ({ src, alt }) => (
            <MarkdownImageLink src={src} alt={alt} className={`${c.link} underline`} />
          ),
          // Horizontal rule
          hr: () => <hr className={`${c.hr} my-3`} />,
          // Table
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-xs border-collapse">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={c.thead}>{children}</thead>
          ),
          th: ({ children }) => (
            <th className={`border ${c.cell} px-2 py-1 text-start ${c.th} font-semibold`}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`border ${c.cell} px-2 py-1 ${c.body}`}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className={`streaming-cursor inline-block w-1.5 h-4 ${c.cursor} ms-0.5 align-middle rounded-sm`} />
      )}
    </div>
  )
}

export default AIMarkdownRenderer
