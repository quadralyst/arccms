# Global Table Component

A reusable, configuration-driven table component for Angular applications. It supports sorting, pagination, dynamic actions, and various built-in column types without requiring HTML templates.

## Usage

Import `GlobalTableComponent` in your component:

```typescript
import { GlobalTableComponent, TableColumn } from 'src/shared/components/global-table/global-table.component';

@Component({
  standalone: true,
  imports: [GlobalTableComponent]
})
```

## Basic Example

```html
<app-global-table 
    [data]="users" 
    [columns]="tableColumns"
    [loading]="isLoading"
    [pageIndex]="currentPage"
    [pageSize]="pageSize"
    (actionClick)="handleAction($event)"
    (cellClick)="handleCellClick($event)">
</app-global-table>
```

```typescript
tableColumns: TableColumn[] = [
    { key: 'index', header: '#', type: 'index' },
    { key: 'name', header: 'Name', clickable: true, classFn: () => 'fw-bold' },
    { key: 'email', header: 'Email' }, // Default type is 'text'
    { key: 'role', header: 'Role', type: 'badge' },
    { key: 'joinedAt', header: 'Joined', type: 'date' }
];
```

## Configuration (TableColumn)

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Property key of the data object. |
| `header` | `string` | Column header text. |
| `type` | `string` | `'text'` (default), `'index'`, `'date'`, `'badge'`, `'actions'`, `'code'`. |
| `sortable` | `boolean` | Enable sorting for this column. |
| `clickable` | `boolean` | If true, clicking cell emits `cellClick`. |
| `transformFn` | `(row) => string` | Function to transform displayed value. |
| `classFn` | `(row) => string` | Function to return CSS classes for the cell content. |
| `dateFormat` | `string` | Format for `date` type: an Angular date pattern (e.g. `'dd MMM yyyy'`) or an arcTime format such as `'dateTime'` or `'ago'` (docs/app/clock-and-zones.html). Default `'MMM d, y'`. |
| `dateZone` | `ZoneRef \| (row) => ZoneRef` | Zone for `date` type: the reader's own by default; `'site'`, an IANA name such as `'Europe/Zurich'`, or a function of the row for a table of places. |
| `badgeConfig` | `Object` | Config for `badge` type (see below). |
| `actions` | `TableAction[]` | Config for `actions` type (see below). |

### Column Types

- **text**: Default. Displays text. Supports `transformFn` and `clickable`.
- **index**: Displays row number based on `pageIndex` and `pageSize`.
- **date**: Formats dates. Handles JS Date and Firestore Timestamps automatically.
- **badge**: Displays a colored badge.
- **code**: Displays text in a `<code>` block.
- **actions**: Displays action buttons.

### Badge Configuration
```typescript
{
    type: 'badge',
    badgeConfig: {
        trueClass: 'badge bg-success',   // Class for truthy values
        falseClass: 'badge bg-secondary', // Class for falsy values
        trueText: 'Active',
        falseText: 'Inactive'
    }
}
```
*Note: You can also use `classFn` on a badge column to return dynamic classes based on complex logic.*

### Actions Configuration

List the row's actions; the table decides the layout, so pages rarely need more than this:

```typescript
{
    key: 'actions',
    header: 'common.table.actions',
    type: 'actions',
    actions: [
        { action: 'view', icon: 'fas fa-eye text-secondary', label: 'common.actions.view', onAction: (row) => this.openView(row) },
        { action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', onAction: (row) => this.openEdit(row) },
        { action: 'block', icon: 'fas fa-ban', labelFn: (row) => row.isActive ? 'Block' : 'Unblock', onAction: (row) => this.toggle(row) },
        { action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', hide: (row) => row.isProtected, onAction: (row) => this.delete(row) }
    ]
}
```

How the table lays them out:

- **Up to 3 actions in the table** (2 on a narrow screen): all show as icons.
- **More than that:** the top 2 (1 on a narrow screen) stay as icons; the rest go into a "more" menu with their labels.
- **Danger actions come last:** after a small gap inline, or below a divider (in red) in the menu. `delete`, `remove`, `archive`, `cancel` and any action with `class: 'delete'` count as danger.
- **Order:** `edit` first, then `view` / `open` / `preview`, then the rest in the order given, danger last.
- **Every row gets the same layout:** the count is of actions some row on the page shows (after `hide`), and a row that hides an action keeps an empty slot so icons line up and the column never grows past 3.
- **Menu icons are grey:** colour classes such as `text-primary` apply to the inline icons only; danger items in the menu are red.

Optional settings for when the defaults are wrong:

| Property | Where | Description |
|----------|-------|-------------|
| `danger` | action | Force danger on or off. |
| `priority` | action | Lower comes first (edit 10, view 20, others 50, danger 90). |
| `slot` | action | Actions that never show together (activate / pause / resume) share a slot name so they take one position. |
| `placement` | action | `'inline'` or `'menu'` to force where it goes. |
| `maxInline` | column | Icons kept inline once the menu is in use (default 2). |

The layout lives in `arc-row-actions` (`src/shared/components/row-actions/`). A hand-built table can use it directly; pass every row on the page as `rows` so all rows line up:

```html
<arc-row-actions [actions]="rowActions" [row]="item" [rows]="items()"></arc-row-actions>
```

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `data` | `any[]` | `[]` | Array of data objects. |
| `columns` | `TableColumn[]` | `[]` | Column configuration. |
| `loading` | `boolean` | `false` | Shows the loading rows in place of the table. |
| `pageIndex` | `number` | `0` | Current page index (0-based). |
| `pageSize` | `number` | `10` | Items per page. |
| `sortField` | `string` | `''` | Current sort key. |
| `sortOrder` | `'asc' \| 'desc'` | `'desc'` | Current sort order. |
| `emptyTitle` | `string` | `'No Items Yet'` | Empty state heading. A translation key or plain text. |
| `emptyDescription` | `string` | `'Create your first item to get started.'` | Empty state line. A translation key or plain text. |
| `emptyIcon` | `string` | `'fas fa-list-alt'` | Empty state icon class. |
| `showEmptyAction` | `boolean` | `true` | Shows the empty state button. |
| `emptyActionLabel` | `string` | `'Create Item'` | Empty state button text. A translation key or plain text. |
| `emptyActionIcon` | `string` | `'fas fa-plus'` | Empty state button icon class. |
| `error` | `string \| boolean \| null` | `null` | The list failed to load. `true` shows the standard sentence; a string (a translation key or a plain sentence) is shown instead. See below. |
| `filtered` | `boolean` | `false` | A search or filter is narrowing the rows. With no rows, the table says "Nothing matches" instead of the empty state. |
| `noMatchTitle` | `string` | `'common.table.no_match_title'` ("Nothing matches") | Heading when `filtered` and no rows. A translation key or plain text. |
| `noMatchDescription` | `string` | `'common.table.no_match_text'` ("Try other words, or clear the filters.") | Line under it. A translation key or plain text. |
| `trackByFn` | `(index, item) => any` | `item.id \|\| index` | Row identity. |

## Outputs

| Output | Emits | When |
|--------|-------|------|
| `actionClick` | `{ action: string, row: any }` | A row action without its own `onAction` is pressed. |
| `cellClick` | `{ key: string, row: any }` | A `clickable` cell is pressed. |
| `sortChange` | `string` (the column key) | A sortable heading is pressed. |
| `emptyActionClick` | `void` | The empty state button is pressed. |
| `retry` | `void` | **Retry** in the error state is pressed. The button shows only when this output is bound. |
| `clearFilters` | `void` | **Clear filters** in the "nothing matches" state is pressed. The button shows only when this output is bound. |

## Error, nothing matches, and nothing yet

A list has three ways to show no rows, and each needs different words:

| State | Shown when | What it says |
|-------|-----------|--------------|
| Error | `error` is set and `loading` is false | "This list did not load", your sentence or "Check your connection and try again.", and **Retry** when `(retry)` is bound. Announced to screen readers (`role="alert"`). |
| Nothing matches | `filtered` is true, there are no rows, and no error | "Nothing matches", "Try other words, or clear the filters.", and **Clear filters** when `(clearFilters)` is bound. |
| Nothing yet | No rows, not filtered, no error | The `empty*` inputs: the "create your first" state. |

An error wins over the other two. When rows are already on screen (a refresh failed), the error shows as one line above them and the rows stay. While `loading` is true, only the loading rows show.

Pass a plain sentence as `error`, never the raw error: keep the technical detail in the console.

```html
<app-global-table
    [data]="rows()"
    [columns]="columns"
    [loading]="loading()"
    [error]="loadError()"
    (retry)="load()"
    [filtered]="!!search() || status() !== 'all'"
    (clearFilters)="clearFilters()"
    emptyTitle="admin.things.empty_title"
    emptyDescription="admin.things.empty_text">
</app-global-table>
```

```typescript
readonly loadError = signal<string | boolean | null>(null);

async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
        this.rows.set(await this.service.list());
    } catch (e) {
        console.error('Loading things failed', e);
        this.loadError.set(true); // or 'admin.things.load_failed' for your own sentence
    } finally {
        this.loading.set(false);
    }
}
```

The app has no zone.js: change these inputs through signals (as above) or by replacing values, so the page's view refreshes and passes them in.

## Accessibility and phones

- A sortable heading is a `<button>` inside the heading cell, and the cell carries `aria-sort` (`ascending`, `descending` or `none`). Headings that cannot sort have neither.
- Row actions are at least 44px on a touch screen, and every icon has a name: its `label`, else the common name for its action (`edit` is read as "Edit"), else the action itself. Give each action a `label`.
- When the actions column is the last column, it stays pinned to the right edge while a wide table scrolls sideways, so the actions stay in reach on a phone.
