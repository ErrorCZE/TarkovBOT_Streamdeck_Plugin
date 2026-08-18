import { action } from "@elgato/streamdeck";
import { TarkovCurrentMapInfo_Boss } from "./current-map-boss";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo0" })
export class TarkovCurrentMapInfo_Boss_First extends TarkovCurrentMapInfo_Boss { constructor() { super(0); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo1" })
export class TarkovCurrentMapInfo_Boss_Second extends TarkovCurrentMapInfo_Boss { constructor() { super(1); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo2" })
export class TarkovCurrentMapInfo_Boss_Third extends TarkovCurrentMapInfo_Boss { constructor() { super(2); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo3" })
export class TarkovCurrentMapInfo_Boss_Fourth extends TarkovCurrentMapInfo_Boss { constructor() { super(3); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo4" })
export class TarkovCurrentMapInfo_Boss_Fifth extends TarkovCurrentMapInfo_Boss { constructor() { super(4); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo5" })
export class TarkovCurrentMapInfo_Boss_Sixth extends TarkovCurrentMapInfo_Boss { constructor() { super(5); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo6" })
export class TarkovCurrentMapInfo_Boss_Seventh extends TarkovCurrentMapInfo_Boss { constructor() { super(6); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo7" })
export class TarkovCurrentMapInfo_Boss_Eighth extends TarkovCurrentMapInfo_Boss { constructor() { super(7); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo8" })
export class TarkovCurrentMapInfo_Boss_Ninth extends TarkovCurrentMapInfo_Boss { constructor() { super(8); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo9" })
export class TarkovCurrentMapInfo_Boss_Tenth extends TarkovCurrentMapInfo_Boss { constructor() { super(9); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo10" })
export class TarkovCurrentMapInfo_Boss_Eleventh extends TarkovCurrentMapInfo_Boss { constructor() { super(10); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo11" })
export class TarkovCurrentMapInfo_Boss_Twelfth extends TarkovCurrentMapInfo_Boss { constructor() { super(11); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo12" })
export class TarkovCurrentMapInfo_Boss_Thirteenth extends TarkovCurrentMapInfo_Boss { constructor() { super(12); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo13" })
export class TarkovCurrentMapInfo_Boss_Fourteenth extends TarkovCurrentMapInfo_Boss { constructor() { super(13); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo14" })
export class TarkovCurrentMapInfo_Boss_Fifteenth extends TarkovCurrentMapInfo_Boss { constructor() { super(14); } }

@action({ UUID: "eu.tarkovbot.tools.mapinfo.bossinfo15" })
export class TarkovCurrentMapInfo_Boss_Sixteenth extends TarkovCurrentMapInfo_Boss { constructor() { super(15); } }

export function createAllBossInstances(): TarkovCurrentMapInfo_Boss[] {
    return [
        new TarkovCurrentMapInfo_Boss_First(),
        new TarkovCurrentMapInfo_Boss_Second(),
        new TarkovCurrentMapInfo_Boss_Third(),
        new TarkovCurrentMapInfo_Boss_Fourth(),
        new TarkovCurrentMapInfo_Boss_Fifth(),
        new TarkovCurrentMapInfo_Boss_Sixth(),
        new TarkovCurrentMapInfo_Boss_Seventh(),
        new TarkovCurrentMapInfo_Boss_Eighth(),
        new TarkovCurrentMapInfo_Boss_Ninth(),
        new TarkovCurrentMapInfo_Boss_Tenth(),
        new TarkovCurrentMapInfo_Boss_Eleventh(),
        new TarkovCurrentMapInfo_Boss_Twelfth(),
        new TarkovCurrentMapInfo_Boss_Thirteenth(),
        new TarkovCurrentMapInfo_Boss_Fourteenth(),
        new TarkovCurrentMapInfo_Boss_Fifteenth(),
        new TarkovCurrentMapInfo_Boss_Sixteenth(),
    ];
}
