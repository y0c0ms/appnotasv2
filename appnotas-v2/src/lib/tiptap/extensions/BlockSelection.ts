import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        blockSelection: {
            /**
             * Move selection head up to the start of the current or previous block
             */
            moveSelectionHeadUp: () => ReturnType,
            /**
             * Move selection head down to the end of the current or next block
             */
            moveSelectionHeadDown: () => ReturnType,
        }
    }
}

export const BlockSelection = Extension.create({
    name: 'blockSelection',

    addKeyboardShortcuts() {
        return {
            'Control-w': () => this.editor.commands.moveSelectionHeadUp(),
            'Control-e': () => this.editor.commands.moveSelectionHeadDown(),
        };
    },

    addCommands() {
        return {
            moveSelectionHeadUp: () => ({ state, dispatch }) => {
                const { selection, doc } = state;
                const { anchor, head } = selection;

                const charAtHead = head > 0 ? doc.textBetween(head - 1, head) : '';
                const charAfterHead = head < doc.content.size ? doc.textBetween(head, head + 1) : '';
                const brackets: Record<string, string> = { '}': '{', ']': '[', ')': '(' };

                let targetBracket = '';
                let searchFrom = -1;

                if (brackets[charAtHead]) {
                    targetBracket = charAtHead;
                    searchFrom = head - 1;
                } else if (brackets[charAfterHead]) {
                    targetBracket = charAfterHead;
                    searchFrom = head;
                }

                if (targetBracket) {
                    // Search for opening bracket
                    let match = -1;
                    let depth = 0;
                    for (let i = searchFrom - 1; i >= 0; i--) {
                        const char = doc.textBetween(i, i + 1);
                        if (char === targetBracket) depth++;
                        else if (char === brackets[targetBracket]) {
                            if (depth === 0) {
                                match = i;
                                break;
                            }
                            depth--;
                        }
                    }

                    if (match !== -1) {
                        if (dispatch) {
                            dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, match)));
                        }
                        return true;
                    }
                }

                const charBeforeHead = doc.textBetween(head - 1, head);
                // (Already handled above but keep for clarity if needed)

                const resolvedHead = doc.resolve(head);
                const depth = Math.max(1, resolvedHead.depth);
                const blockStart = resolvedHead.before(depth);
                const parentType = resolvedHead.parent.type.name;

                let newHead = head;

                // Handle codeBlock differently (line by line via newlines)
                if (parentType === 'codeBlock') {
                    const textBefore = doc.textBetween(blockStart, head);
                    const lastNewline = textBefore.lastIndexOf('\n');

                    if (lastNewline !== -1 && (blockStart + lastNewline + 1) < head) {
                        // Move to start of current line
                        newHead = blockStart + lastNewline + 1;
                    } else if (lastNewline !== -1) {
                        // Already at start of line, move to start of previous line
                        const textBeforePrev = doc.textBetween(blockStart, blockStart + lastNewline);
                        const prevNewline = textBeforePrev.lastIndexOf('\n');
                        newHead = prevNewline === -1 ? blockStart : blockStart + prevNewline + 1;
                    } else if (head > blockStart) {
                        // Move to absolute start of block
                        newHead = blockStart;
                    } else if (blockStart > 0) {
                        // Move to start of previous block outside codeBlock
                        const prevPos = blockStart - 1;
                        const resolvedPrev = doc.resolve(prevPos);
                        newHead = resolvedPrev.before(Math.max(1, resolvedPrev.depth));
                    }
                } else {
                    if (head > blockStart) {
                        newHead = blockStart;
                    } else if (blockStart > 0) {
                        const prevPos = blockStart - 1;
                        const resolvedPrev = doc.resolve(prevPos);
                        newHead = resolvedPrev.before(Math.max(1, resolvedPrev.depth));
                    }
                }

                if (newHead !== head) {
                    if (dispatch) {
                        dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, newHead)));
                    }
                    return true;
                }
                return false;
            },
            moveSelectionHeadDown: () => ({ state, dispatch }) => {
                const { selection, doc } = state;
                const { anchor, head } = selection;

                const charAtHead = head < doc.content.size ? doc.textBetween(head, head + 1) : '';
                const charBeforeHead = head > 0 ? doc.textBetween(head - 1, head) : '';
                const brackets: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

                let targetBracket = '';
                let searchFrom = -1;

                if (brackets[charAtHead]) {
                    targetBracket = charAtHead;
                    searchFrom = head;
                } else if (brackets[charBeforeHead]) {
                    targetBracket = charBeforeHead;
                    searchFrom = head - 1;
                }

                if (targetBracket) {
                    // Search for closing bracket
                    let match = -1;
                    let depth = 0;
                    for (let i = searchFrom + 1; i < doc.content.size; i++) {
                        const char = doc.textBetween(i, i + 1);
                        if (char === targetBracket) depth++;
                        else if (char === brackets[targetBracket]) {
                            if (depth === 0) {
                                match = i + 1;
                                break;
                            }
                            depth--;
                        }
                    }

                    if (match !== -1) {
                        if (dispatch) {
                            dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, match)));
                        }
                        return true;
                    }
                }

                const resolvedHead = doc.resolve(head);
                const depth = Math.max(1, resolvedHead.depth);
                const blockEnd = resolvedHead.after(depth);
                const parentType = resolvedHead.parent.type.name;

                let newHead = head;

                // Handle codeBlock differently (line by line via newlines)
                if (parentType === 'codeBlock') {
                    const textAfter = doc.textBetween(head, blockEnd);
                    const firstNewline = textAfter.indexOf('\n');

                    if (firstNewline !== -1 && (head + firstNewline) > head) {
                        // Move to end of current line
                        newHead = head + firstNewline;
                    } else if (firstNewline !== -1) {
                        // Already at end of line, move to end of next line
                        const textAfterNext = doc.textBetween(head + 1, blockEnd);
                        const nextNewline = textAfterNext.indexOf('\n');
                        newHead = nextNewline === -1 ? blockEnd : head + 1 + nextNewline;
                    } else if (head < blockEnd) {
                        // Move to absolute end of block
                        newHead = blockEnd;
                    } else if (blockEnd < doc.content.size) {
                        const nextPos = blockEnd + 1;
                        const resolvedNext = doc.resolve(nextPos);
                        newHead = resolvedNext.after(Math.max(1, resolvedNext.depth));
                    }
                } else {
                    if (head < blockEnd) {
                        newHead = blockEnd;
                    } else if (blockEnd < doc.content.size) {
                        const nextPos = blockEnd + 1;
                        const resolvedNext = doc.resolve(nextPos);
                        newHead = resolvedNext.after(Math.max(1, resolvedNext.depth));
                    }
                }

                if (newHead !== head) {
                    if (dispatch) {
                        dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, newHead)));
                    }
                    return true;
                }
                return false;
            },
        };
    },
});
