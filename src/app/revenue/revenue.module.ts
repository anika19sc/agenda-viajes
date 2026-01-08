import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { RevenuePageRoutingModule } from './revenue-routing.module';

import { RevenuePage } from './revenue.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RevenuePageRoutingModule
  ],
  declarations: [RevenuePage]
})
export class RevenuePageModule {}
