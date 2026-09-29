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
| `dateFormat` | `string` | Format string for `date` type (e.g. `'dd MMM yyyy'`). |
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
| `loading` | `boolean` | `false` | data loading state. |
| `pageIndex` | `number` | `0` | Current page index (0-based). |
| `pageSize` | `number` | `10` | Items per page. |
| `sortField` | `string` | `''` | Current sort key. |
| `sortOrder` | `'asc' \| 'desc'` | `'desc'` | Current sort order. |
| `emptyTitle` | `string` | ... | Title for empty state. |

## Outputs

- **actionClick**: Emits `{ action: string, row: any }` when an action button is clicked.
- **cellClick**: Emits `{ key: string, row: any }` when a `clickable` cell is clicked.
- **sortChange**: Emits `string` (column key) when a header is clicked.
- **emptyActionClick**: Emits `void` when the empty state button is clicked.
