import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AngularNodeViewComponent } from 'ngx-tiptap';

@Component({
  selector: 'mentions-list',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './mentions.component.html',
  styleUrls: ['./mentions.component.scss'],
})
export class MenitonsList extends AngularNodeViewComponent implements OnInit {
  @Input('props') props!: Record<string, any>;

  selectedIndex = 0;

  upHandler() {
    this.selectedIndex =
      (this.selectedIndex + this.props['items'].length - 1) %
      this.props['items'].length;
  }

  downHandler() {
    this.selectedIndex = (this.selectedIndex + 1) % this.props['items'].length;
  }

  enterHandler() {
    this.selectItem(this.selectedIndex);
  }

  selectItem(index: number) {
    const item = this.props['items'][index];

    if (item) {
      this.props['command']({ id: item });
    }
  }

  onKeyDown({ event }: any) {
    if (event.key === 'ArrowUp') {
      this.upHandler();
      return true;
    }

    if (event.key === 'ArrowDown') {
      this.downHandler();
      return true;
    }

    if (event.key === 'Enter') {
      this.enterHandler();
      return true;
    }

    return false;
  }

  ngOnInit() {}
}
