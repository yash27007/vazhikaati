import type { createDb } from '../db/client';
import { agencies, stops, routes, calendars, trips, stopTimes, transfers } from '../db/schema';

const DEMO_AGENCY_ID = 'DEMO';
const DEMO_CALENDAR_ID = 'DEMO_DAILY';

interface DemoTrip {
  tripId: string;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  departureMinutes: number;
  arrivalMinutes: number;
}

const DEMO_TRIPS: DemoTrip[] = [
  { tripId: 'OOTY_MTP_EARLY', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 480, arrivalMinutes: 570 },
  { tripId: 'OOTY_MTP_A', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 940, arrivalMinutes: 1030 },
  { tripId: 'OOTY_MTP_B', routeId: 'DEMO-OOTY-MTP', fromStopId: 'OOTY_STAND', toStopId: 'METTUPALAYAM_STAND', departureMinutes: 1040, arrivalMinutes: 1130 },

  // Departures sit 55 minutes after the inbound Ooty->Mettupalayam arrival
  // (50 minutes of slack over the 5-minute default same-stand buffer) so
  // this transfer scores "safe" — the only connection this corridor is
  // meant to threaten is the one at Tirupur.
  { tripId: 'MTP_TPR_EARLY', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 625, arrivalMinutes: 740 },
  { tripId: 'MTP_TPR_A', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 1085, arrivalMinutes: 1200 },
  { tripId: 'MTP_TPR_B', routeId: 'DEMO-MTP-TPR', fromStopId: 'METTUPALAYAM_STAND', toStopId: 'TIRUPUR_OLD_STAND', departureMinutes: 1185, arrivalMinutes: 1300 },

  // The last Tirupur -> Madurai service of the day. Miss this and the next
  // one isn't until 04:30 the following morning.
  { tripId: 'TPR_MDU_LAST', routeId: 'DEMO-TPR-MDU', fromStopId: 'TIRUPUR_NEW_STAND', toStopId: 'MADURAI_STAND', departureMinutes: 1275, arrivalMinutes: 1320 },
  { tripId: 'TPR_MDU_EARLY', routeId: 'DEMO-TPR-MDU', fromStopId: 'TIRUPUR_NEW_STAND', toStopId: 'MADURAI_STAND', departureMinutes: 270, arrivalMinutes: 315 },

  { tripId: 'MDU_SVP_LAST', routeId: 'DEMO-MDU-SVP', fromStopId: 'MADURAI_STAND', toStopId: 'SRIVILLIPUTHUR_STAND', departureMinutes: 1350, arrivalMinutes: 1410 },
  { tripId: 'MDU_SVP_EARLY', routeId: 'DEMO-MDU-SVP', fromStopId: 'MADURAI_STAND', toStopId: 'SRIVILLIPUTHUR_STAND', departureMinutes: 345, arrivalMinutes: 405 },
];

/**
 * Hand-authored, clearly-flagged synthetic (tier-3) corridor reproducing the
 * worked example from the product spec: Ooty -> Mettupalayam -> Tirupur ->
 * Madurai -> Srivilliputhur, including the deliberate stranding scenario.
 * Nothing here is real published SETC data.
 */
export async function ingestDemoCorridor(db: ReturnType<typeof createDb>): Promise<void> {
  await db
    .insert(agencies)
    .values({
      agencyId: DEMO_AGENCY_ID,
      name: 'Demo Corridor (synthetic — not a real operator)',
      agencyType: 'informal',
      stateCode: 'TN',
      dataTier: 3,
    })
    .onConflictDoNothing();

  await db
    .insert(calendars)
    .values({
      serviceId: DEMO_CALENDAR_ID,
      monday: true, tuesday: true, wednesday: true, thursday: true,
      friday: true, saturday: true, sunday: true,
      startDate: '2020-01-01',
      endDate: '2035-12-31',
    })
    .onConflictDoNothing();

  await db
    .insert(stops)
    .values([
      { stopId: 'OOTY_STAND', name: 'Ooty Bus Stand', stopType: 'terminus', townId: 'OOTY', dataTier: 3 },
      { stopId: 'METTUPALAYAM_STAND', name: 'Mettupalayam Bus Stand', stopType: 'town_stand', townId: 'METTUPALAYAM', dataTier: 3 },
      { stopId: 'TIRUPUR_OLD_STAND', name: 'Tirupur Old Bus Stand', stopType: 'mofussil_stand', townId: 'TIRUPUR', safeOvernight: false, isLitAtNight: true, dataTier: 3 },
      { stopId: 'TIRUPUR_NEW_STAND', name: 'Tirupur New Bus Stand', stopType: 'mofussil_stand', townId: 'TIRUPUR', safeOvernight: false, isLitAtNight: true, dataTier: 3 },
      { stopId: 'MADURAI_STAND', name: 'Madurai Bus Stand', stopType: 'terminus', townId: 'MADURAI', dataTier: 3 },
      { stopId: 'SRIVILLIPUTHUR_STAND', name: 'Srivilliputhur Bus Stand', stopType: 'town_stand', townId: 'SRIVILLIPUTHUR', dataTier: 3 },
    ])
    .onConflictDoNothing();

  await db
    .insert(transfers)
    .values({
      fromStopId: 'TIRUPUR_OLD_STAND',
      toStopId: 'TIRUPUR_NEW_STAND',
      minTransferMinutes: 10,
      transferMode: 'auto',
      approxCostInr: 30,
      notes: 'Cross-town auto between the two Tirupur stands',
    })
    .onConflictDoNothing();

  await db
    .insert(routes)
    .values([
      { routeId: 'DEMO-OOTY-MTP', agencyId: DEMO_AGENCY_ID, routeShortName: 'D1', routeLongName: 'Ooty - Mettupalayam', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-MTP-TPR', agencyId: DEMO_AGENCY_ID, routeShortName: 'D2', routeLongName: 'Mettupalayam - Tirupur', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-TPR-MDU', agencyId: DEMO_AGENCY_ID, routeShortName: 'D3', routeLongName: 'Tirupur - Madurai', routeType: 'ultra_deluxe' },
      { routeId: 'DEMO-MDU-SVP', agencyId: DEMO_AGENCY_ID, routeShortName: 'D4', routeLongName: 'Madurai - Srivilliputhur', routeType: 'ultra_deluxe' },
    ])
    .onConflictDoNothing();

  for (const t of DEMO_TRIPS) {
    await db
      .insert(trips)
      .values({
        tripId: t.tripId,
        routeId: t.routeId,
        serviceId: DEMO_CALENDAR_ID,
        headsign: t.toStopId,
        vehicleType: 'ULTRA',
        bookable: true,
        dataTier: 3,
      })
      .onConflictDoNothing();

    await db
      .insert(stopTimes)
      .values([
        { tripId: t.tripId, stopSequence: 1, stopId: t.fromStopId, arrivalMinutes: t.departureMinutes, departureMinutes: t.departureMinutes, haltMinutes: 0 },
        { tripId: t.tripId, stopSequence: 2, stopId: t.toStopId, arrivalMinutes: t.arrivalMinutes, departureMinutes: t.arrivalMinutes, haltMinutes: 0 },
      ])
      .onConflictDoNothing();
  }
}
