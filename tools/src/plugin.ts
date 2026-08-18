import streamDeck from "@elgato/streamdeck";

import { TarkovTime } from "./actions/tarkov-time";
import { TarkovGoonsLocation } from "./actions/goons-location";
import { TarkovTraderRestock } from "./actions/trader-restock";
import { TarkovCurrentMapInfo } from "./actions/current-map-info";
import { TarkovCurrentMapInfo_Name } from "./actions/current-map-name";
import { TarkovCurrentMapInfo_Duration } from "./actions/current-map-duration";
import { TarkovCurrentMapInfo_Players } from "./actions/current-map-players";
import { TarkovCurrentMapInfo_BackToProfile } from "./actions/current-map-backtoprofile";
import { TarkovCurrentMapInfo_CurrentServer } from "./actions/current-map-server";
import { TarkovCurrentServerInfo } from "./actions/current-server";
import { createAllBossInstances } from "./actions/current-map-bosses";
import { startBackgroundRefreshers } from "./services/background-refresh";

startBackgroundRefreshers();

streamDeck.actions.registerAction(new TarkovTime());
streamDeck.actions.registerAction(new TarkovGoonsLocation());
streamDeck.actions.registerAction(new TarkovTraderRestock());

streamDeck.actions.registerAction(new TarkovCurrentMapInfo());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Name());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Duration());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Players());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_CurrentServer());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_BackToProfile());

for (const bossInstance of createAllBossInstances()) {
    streamDeck.actions.registerAction(bossInstance);
}

streamDeck.actions.registerAction(new TarkovCurrentServerInfo());

streamDeck.connect();
