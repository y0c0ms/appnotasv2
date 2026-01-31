import { Node, mergeAttributes } from '@tiptap/core'

export const Drawing = Node.create({
    name: 'drawing',

    group: 'block',

    atom: true,

    addAttributes() {
        return {
            lines: {
                default: [],
                renderHTML: attributes => ({
                    'data-lines': JSON.stringify(attributes.lines)
                }),
                parseHTML: element => {
                    const data = element.getAttribute('data-lines')
                    try { return data ? JSON.parse(data) : [] } catch { return [] }
                },
            },
            height: {
                default: 300,
                renderHTML: attributes => ({
                    style: `height: ${attributes.height}px`
                }),
                parseHTML: element => parseInt(element.style.height) || 300,
            }
        }
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="drawing"]',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })]
    },

    addNodeView() {
        return ({ node, HTMLAttributes, getPos, editor }) => {
            const dom = document.createElement('div')
            dom.classList.add('drawing-node')
            dom.style.position = 'relative'

            const container = document.createElement('div')
            container.classList.add('drawing-container')
            container.style.height = `${node.attrs.height}px`
            dom.append(container)

            const canvas = document.createElement('canvas')
            canvas.style.cursor = 'crosshair'
            container.append(canvas)

            const resizeHandle = document.createElement('div')
            resizeHandle.classList.add('drawing-resize-handle')
            dom.append(resizeHandle)

            const ctx = canvas.getContext('2d')
            if (!ctx) return { dom }

            // Extremely robust lines retrieval
            let lines: any[] = []
            const nodeLines = node.attrs.lines

            if (Array.isArray(nodeLines)) {
                lines = [...nodeLines]
            } else if (typeof nodeLines === 'string' && nodeLines.length > 0) {
                // Ignore clearly invalid non-JSON strings like "[object Object]"
                if (nodeLines.startsWith('[') || nodeLines.startsWith('{')) {
                    try {
                        lines = JSON.parse(nodeLines)
                    } catch (e) {
                        lines = []
                    }
                }
            }

            const draw = () => {
                if (!ctx) return
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                ctx.lineJoin = 'round'
                ctx.lineCap = 'round'
                ctx.strokeStyle = '#4a9eff'
                ctx.lineWidth = 2

                lines.forEach((line: any) => {
                    if (Array.isArray(line) && line.length > 0) {
                        ctx.beginPath()
                        line.forEach((point: any, index: number) => {
                            const x = (point.x / 500) * canvas.width
                            const y = (point.y / node.attrs.height) * canvas.height
                            if (index === 0) ctx.moveTo(x, y)
                            else ctx.lineTo(x, y)
                        })
                        ctx.stroke()
                    }
                })
            }

            const syncSize = () => {
                const rect = container.getBoundingClientRect()
                if (rect.width === 0) return
                canvas.width = rect.width
                canvas.height = rect.height
                draw()
            }

            // Initial resize & observer
            setTimeout(syncSize, 0)
            const observer = new ResizeObserver(syncSize)
            observer.observe(container)

            let isDrawing = false
            let currentLine: any[] = []

            canvas.addEventListener('mousedown', (e) => {
                isDrawing = true
                const rect = canvas.getBoundingClientRect()
                const x = (e.clientX - rect.left) * (500 / canvas.width)
                const y = (e.clientY - rect.top) * (node.attrs.height / canvas.height)
                currentLine = [{ x, y }]
                lines.push(currentLine)
            })

            canvas.addEventListener('mousemove', (e) => {
                if (!isDrawing) return
                const rect = canvas.getBoundingClientRect()
                const x = (e.clientX - rect.left) * (500 / canvas.width)
                const y = (e.clientY - rect.top) * (node.attrs.height / canvas.height)
                currentLine.push({ x, y })
                draw()
            })

            canvas.addEventListener('mouseup', () => {
                isDrawing = false
                if (typeof getPos === 'function') {
                    editor.commands.updateAttributes('drawing', {
                        lines: [...lines]
                    })
                }
            })

            // Resizing logic
            let isResizing = false
            let startY = 0
            let startHeight = 0

            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true
                startY = e.clientY
                startHeight = container.offsetHeight
                document.addEventListener('mousemove', onMouseMove)
                document.addEventListener('mouseup', onMouseUp)
                e.preventDefault()
            })

            const onMouseMove = (e: MouseEvent) => {
                if (!isResizing) return
                const delta = e.clientY - startY
                const newHeight = Math.max(100, Math.min(800, startHeight + delta))
                container.style.height = `${newHeight}px`
                syncSize()
            }

            const onMouseUp = () => {
                if (isResizing && typeof getPos === 'function') {
                    editor.commands.updateAttributes('drawing', {
                        height: container.offsetHeight
                    })
                }
                isResizing = false
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
            }

            return {
                dom,
                destroy: () => observer.disconnect()
            }
        }
    },
})
