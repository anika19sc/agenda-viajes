import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { RevenuePage } from './revenue.page';

const routes: Routes = [
  {
    path: '',
    component: RevenuePage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RevenuePageRoutingModule {}
