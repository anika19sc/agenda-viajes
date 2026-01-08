import { Component, inject } from '@angular/core';
import { DatabaseService } from '../services/database.service';
import { ShareService } from '../services/share.service';

@Component({
  selector: 'app-revenue',
  templateUrl: './revenue.page.html',
  styleUrls: ['./revenue.page.scss'],
})
export class RevenuePage {
  private db = inject(DatabaseService);
  private shareService = inject(ShareService);

  public totalRevenue = this.db.totalRevenue;
  public sectionTotals = this.db.sectionTotals;
  public sectionCounts = this.db.sectionCounts;
  public currentDate = this.db.currentDate;
  public trips = this.db.trips;

  async prevDay() {
    await this.db.prevDay();
  }

  async nextDay() {
    await this.db.nextDay();
  }

  async shareSummary() {
    await this.shareService.shareDailySummary(this.currentDate(), this.trips(), this.totalRevenue());
  }

  constructor() { }
}
