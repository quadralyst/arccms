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
```typescript
{
    type: 'actions',
    actions: [
        { 
            action: 'edit', 
            icon: 'fas fa-pen', 
            label: 'Edit' 
        },
        { 
            action: 'delete', 
            icon: 'fas fa-trash text-danger', // can include color classes
            hide: (row) => row.isProtected // conditionally hide
        }
    ]
}
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
