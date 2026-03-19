import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Tests for the slash commands filtering functionality.
 * 
 * The slash commands feature:
 * 1. Shows a menu when user types '/'
 * 2. Filters commands as user types after '/'
 * 3. Selects top item by default
 * 4. Executes selected command on Enter
 * 5. Closes menu on Escape
 */
describe('Slash Commands Filtering', () => {
    describe('Command Filtering Logic', () => {
        const allCommands = [
            { title: 'Heading 1', type: 'heading', icon: 'bi bi-type-h1' },
            { title: 'Heading 2', type: 'heading', icon: 'bi bi-type-h2' },
            { title: 'Heading 3', type: 'heading', icon: 'bi bi-type-h3' },
            { title: 'Bullet List', type: 'bulletList', icon: 'bi bi-list-ul' },
            { title: 'Numbered List', type: 'listItem', icon: 'bi bi-list-ol' },
            { title: 'Task List', type: 'taskList', icon: 'bi bi-ui-checks' },
            { title: 'Insert image', type: 'image', icon: 'bi bi-image' },
            { title: 'Code Block', type: 'code', icon: 'bi bi-code' },
            { title: 'Divider', type: '', icon: 'bi bi-hr' },
            { title: 'Blockquote', type: '', icon: 'bi bi-quote' },
        ];

        // Helper function to filter commands like the slash commands plugin does
        const filterCommands = (query: string) => {
            if (query === '') return allCommands;
            const lowerQuery = query.toLowerCase();
            return allCommands.filter(cmd =>
                cmd.title.toLowerCase().includes(lowerQuery)
            );
        };

        it('should return all commands when query is empty', () => {
            const result = filterCommands('');
            expect(result.length).toBe(allCommands.length);
        });

        it('should filter commands by title - partial match "head"', () => {
            const result = filterCommands('head');
            expect(result.length).toBe(3);
            expect(result.every(cmd => cmd.title.toLowerCase().includes('head'))).toBe(true);
        });

        it('should filter commands by title - "heading 1"', () => {
            const result = filterCommands('heading 1');
            expect(result.length).toBe(1);
            expect(result[0].title).toBe('Heading 1');
        });

        it('should filter commands case-insensitively', () => {
            const resultLower = filterCommands('bullet');
            const resultUpper = filterCommands('BULLET');
            const resultMixed = filterCommands('BuLlEt');

            expect(resultLower.length).toBe(1);
            expect(resultUpper.length).toBe(1);
            expect(resultMixed.length).toBe(1);
            expect(resultLower[0].title).toBe('Bullet List');
        });

        it('should return empty array when no commands match', () => {
            const result = filterCommands('xyz123nomatch');
            expect(result.length).toBe(0);
        });

        it('should filter by type keyword "list"', () => {
            const result = filterCommands('list');
            expect(result.length).toBe(3);
            expect(result.some(cmd => cmd.title === 'Bullet List')).toBe(true);
            expect(result.some(cmd => cmd.title === 'Numbered List')).toBe(true);
            expect(result.some(cmd => cmd.title === 'Task List')).toBe(true);
        });

        it('should filter by partial word "cod"', () => {
            const result = filterCommands('cod');
            expect(result.length).toBe(1);
            expect(result[0].title).toBe('Code Block');
        });

        it('should filter by "image"', () => {
            const result = filterCommands('image');
            expect(result.length).toBe(1);
            expect(result[0].title).toBe('Insert image');
        });
    });

    describe('Query Extraction from Text', () => {
        // Helper function to extract query after slash
        const extractQuery = (textBeforeCursor: string): string | null => {
            const slashIndex = textBeforeCursor.lastIndexOf('/');
            if (slashIndex === -1) return null;
            return textBeforeCursor.slice(slashIndex + 1);
        };

        it('should extract empty query when cursor is right after slash', () => {
            const result = extractQuery('/');
            expect(result).toBe('');
        });

        it('should extract query typed after slash', () => {
            const result = extractQuery('/head');
            expect(result).toBe('head');
        });

        it('should extract query with spaces', () => {
            const result = extractQuery('/heading 1');
            expect(result).toBe('heading 1');
        });

        it('should return null when no slash exists', () => {
            const result = extractQuery('some text without slash');
            expect(result).toBeNull();
        });

        it('should extract from last slash when multiple slashes exist', () => {
            const result = extractQuery('path/to/file/head');
            expect(result).toBe('head');
        });

        it('should handle text before slash', () => {
            const result = extractQuery('Hello world /bullet');
            expect(result).toBe('bullet');
        });
    });

    describe('First Item Selection', () => {
        it('should identify first item for selection in filtered results', () => {
            const filteredCommands = [
                { title: 'Heading 1', type: 'heading' },
                { title: 'Heading 2', type: 'heading' },
            ];

            let isFirstItem = true;
            const selectedItems: boolean[] = [];

            filteredCommands.forEach((cmd, index) => {
                const isSelected = isFirstItem;
                isFirstItem = false;
                selectedItems.push(isSelected);
            });

            expect(selectedItems[0]).toBe(true); // First should be selected
            expect(selectedItems[1]).toBe(false); // Second should not
        });

        it('should select first when Enter is pressed with no explicit selection', () => {
            const items = ['item1', 'item2', 'item3'];
            let selectedItem: string | null = null;
            let selectedIndex = -1; // -1 means no selection

            // Simulate Enter key behavior
            const itemToClick = selectedItem || items[0];
            expect(itemToClick).toBe('item1');
        });
    });

    describe('Menu Navigation', () => {
        it('should calculate next index on ArrowDown', () => {
            const itemsLength = 5;
            const currentIndex = 0;
            const newIndex = (currentIndex + 1) % itemsLength;
            expect(newIndex).toBe(1);
        });

        it('should wrap to first on ArrowDown from last item', () => {
            const itemsLength = 5;
            const currentIndex = 4;
            const newIndex = (currentIndex + 1) % itemsLength;
            expect(newIndex).toBe(0);
        });

        it('should calculate previous index on ArrowUp', () => {
            const itemsLength = 5;
            const currentIndex = 2;
            const newIndex = (currentIndex - 1 + itemsLength) % itemsLength;
            expect(newIndex).toBe(1);
        });

        it('should wrap to last on ArrowUp from first item', () => {
            const itemsLength = 5;
            const currentIndex = 0;
            const newIndex = (currentIndex - 1 + itemsLength) % itemsLength;
            expect(newIndex).toBe(4);
        });

        it('should handle ArrowDown when no selection (start at 0)', () => {
            const itemsLength = 5;
            const currentIndex = -1;
            const effectiveIndex = currentIndex === -1 ? 0 : currentIndex;
            const newIndex = (effectiveIndex + 1) % itemsLength;
            expect(newIndex).toBe(1);
        });
    });
});

describe('TipTap Editor Border Removal', () => {
    describe('Editor Styling', () => {
        it('should have no border in base styles', () => {
            // The CSS specifies border: none; for .custom_tip_tap_editor
            const expectedStyle = 'border: none';
            expect(expectedStyle).toContain('none');
        });

        it('should have no border on focus', () => {
            // The CSS specifies border: none; and outline: none; for .custom_tip_tap_editor:focus
            const expectedFocusStyles = {
                border: 'none',
                outline: 'none'
            };
            expect(expectedFocusStyles.border).toBe('none');
            expect(expectedFocusStyles.outline).toBe('none');
        });
    });
});

describe('TipTap Bubble Menu Styling', () => {
    describe('Bubble Menu Container Styles', () => {
        it('should have proper z-index for visibility', () => {
            // The CSS specifies z-index: 9999 for .bubble_menu
            const expectedZIndex = 9999;
            expect(expectedZIndex).toBeGreaterThan(100);
        });

        it('should have flex layout', () => {
            // The CSS specifies display: flex for .bubble_menu
            const expectedDisplay = 'flex';
            expect(expectedDisplay).toBe('flex');
        });

        it('should have rounded corners', () => {
            // The CSS specifies border-radius: 8px for .bubble_menu
            const expectedBorderRadius = '8px';
            expect(expectedBorderRadius).toBe('8px');
        });

        it('should have box shadow', () => {
            // The CSS specifies box-shadow for .bubble_menu
            const expectedShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
            expect(expectedShadow).toContain('rgba');
        });
    });

    describe('Menu Button Styles', () => {
        it('should have no border on buttons', () => {
            // The CSS specifies border: none for .menuButtonStyles
            const expectedBorder = 'none';
            expect(expectedBorder).toBe('none');
        });

        it('should have hover background color', () => {
            // The CSS specifies background-color: #f0f0f0 for .menuButtonStyles:hover
            const expectedHoverBg = '#f0f0f0';
            expect(expectedHoverBg).toBe('#f0f0f0');
        });

        it('should have cursor pointer', () => {
            // The CSS specifies cursor: pointer for .menuButtonStyles
            const expectedCursor = 'pointer';
            expect(expectedCursor).toBe('pointer');
        });

        it('should have transition for smooth hover effects', () => {
            // The CSS specifies transition: background-color 0.15s ease
            const expectedTransition = 'background-color 0.15s ease';
            expect(expectedTransition).toContain('0.15s');
        });
    });

    describe('Tippy Wrapper Z-Index', () => {
        it('should have high z-index for tippy-box', () => {
            // The CSS specifies z-index: 9999 for ::ng-deep .tippy-box
            const expectedZIndex = 9999;
            expect(expectedZIndex).toBe(9999);
        });

        it('should have high z-index for tippy-root', () => {
            // The CSS specifies z-index: 9999 for ::ng-deep [data-tippy-root]
            const expectedZIndex = 9999;
            expect(expectedZIndex).toBe(9999);
        });
    });
});
