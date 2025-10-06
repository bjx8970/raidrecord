import { DependencyContainer } from "tsyringe";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import type { DatabaseService } from "@spt/services/DatabaseService";
import type { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import type { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import type { ILogger } from "@spt/models/spt/utils/ILogger";
import path from "node:path";
import { JsonUtil } from "@spt/utils/JsonUtil";
import {StaticRouterModService} from "@spt/services/mod/staticRouter/StaticRouterModService";
import type { ItemHelper } from "@spt/helpers/ItemHelper";
import type { ISearchFriendResponse } from "@spt/models/eft/profile/ISearchFriendResponse";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { FileSystem } from "@spt/utils/FileSystem";
import { IVictim } from "@spt/models/eft/common/tables/IBotBase";
import { IItem } from "@spt/models/eft/common/tables/IItem";
import { BaseClasses } from "@spt/models/enums/BaseClasses";
import { RaidRecordManagerChat } from "./chat";
import { DialogueController } from "@spt/controllers/DialogueController";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { ICoreConfig } from "@spt/models/spt/config/ICoreConfig";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";
import { HashUtil } from "@spt/utils/HashUtil";

import { IRaidInfo, IRaidResultsData, updateRaidInfoByReplaceIDs, 
    loadInventoryInfo, archive2RaidInfo, 
    getItemsValueAll, getAllItemsInContainer,
    IModConfig, getItemsValueWithBaseClasses,
    timeString,
    getValidItemCount} from "./raid"
import ModConfig from "../config/config.json"
import { mapNames, resultNames } from "./lcoals";
import { archive2RaidInfoArchive, IRaidInfoServerArchiveData, IRaidInfoServerData } from "./archive";
const jsonModConfigPath = "../config/config.json"
export const jsonRaidRecordPath = "../db/raid_record.json"
const jsonRaidCachePath = "../db/raid_cache.json"
const defaultJson = () => ({});
import RaidRecordJson from "../db/raid_record.json"
import RaidCacheJson from "../db/raid_cache.json"


/**
 * 将颜色字符串转换为 LogTextColor 枚举值
 * @param colorString 颜色字符串
 * @returns 对应的 LogTextColor 枚举值，如果不存在则返回 LogTextColor.BLUE
 */
function parseColorString(colorString: string): LogTextColor {
    const foundColor = Object.values(LogTextColor).find(
        color => color === colorString
    );
    
    return foundColor || LogTextColor.BLUE;
}

class RaidRecordMod implements IPreSptLoadMod, IPostDBLoadMod
{
    private static container: DependencyContainer = null;
    private logger: ILogger;
    private jsonUtil: JsonUtil;
    private profileHelper: ProfileHelper;
    private databaseService: DatabaseService;
    private fileSystem: FileSystem;
    private itemHelper: ItemHelper;
    private mod_name: string = "突袭战绩记录";
    private raidCaches: IRaidInfoServerData;
    private raidRecords: IRaidInfoServerArchiveData;
    private modConfig: IModConfig;
    private hashUtil: HashUtil;

    protected infoRaid(msg: string): void {
        if (this.logger) {
            this.logger.logWithColor(`[${this.mod_name}] ${msg}`, parseColorString(this.modConfig.LogRaidColor))
        }
    }

    protected info(msg: string): void {
        if (this.logger) {
            this.logger.info(`[${this.mod_name}] ${msg}`);
        }
    }
    
    protected warn(msg: string): void {
        if (this.logger) {
            this.logger.warning(`[${this.mod_name}] ${msg}`);
        }
    }

    protected error(msg: string): void {
        if (this.logger) {
            this.logger.error(`[${this.mod_name}] ${msg}`);
        }
    }

    public preSptLoad(container: DependencyContainer): void {
        if (RaidRecordMod.container == null) {
            RaidRecordMod.container = container;
        }

        this.logger = container.resolve<ILogger>("PrimaryLogger");
        this.jsonUtil = container.resolve<JsonUtil>("JsonUtil");
        this.profileHelper = container.resolve<ProfileHelper>("ProfileHelper");
        this.fileSystem = container.resolve<FileSystem>("FileSystem");
        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.hashUtil = container.resolve<HashUtil>("HashUtil");
        this.raidRecords = RaidRecordJson || defaultJson();
        this.raidCaches = RaidCacheJson || defaultJson();
        this.modConfig = ModConfig;

        this.routerRegister();
    }

    public postDBLoad(container: DependencyContainer): void {
        this.databaseService = container.resolve<DatabaseService>("DatabaseService");
        // 聊天机器人
        container.register('RaidRecordManagerChat.Suntion', RaidRecordManagerChat);
        const chatbot = container.resolve<RaidRecordManagerChat>("RaidRecordManagerChat.Suntion");
        chatbot.init(this.raidRecords);
        container.resolve<DialogueController>("DialogueController").registerChatBot(chatbot);
        const coreConfig = container.resolve<ConfigServer>("ConfigServer").getConfig<ICoreConfig>(ConfigTypes.CORE);
        const myChatBotInfo = chatbot.getChatBot();
        coreConfig.features.chatbotFeatures.ids[myChatBotInfo.Info.Nickname] = myChatBotInfo._id;
        coreConfig.features.chatbotFeatures.enabledBots[myChatBotInfo._id] = true;

        if (this.modConfig.RaidRecordClearAll || this.modConfig.RaidCacheClearAll) {
            if (this.modConfig.RaidRecordClearAll || this.modConfig.RaidCacheClearAll) {
                this.raidCaches = defaultJson();
                this.warn('已清空所有对局缓存')
            }

            if (this.modConfig.RaidRecordClearAll) {
                throw "为了保护你的对局记录, 已拦截本次清理, 如确定需要清理, 建议备份后去src/mod.ts中注释该抛出异常语句";
                this.raidRecords = defaultJson();
                this.fileSystem.writeJson(path.join(__dirname, jsonRaidRecordPath), this.raidRecords, 2);
                this.warn('已清空所有对局记录')
            }
            
            this.modConfig.RaidRecordClearAll = false;
            this.modConfig.RaidCacheClearAll = false;
            this.fileSystem.writeJson(path.join(__dirname, jsonModConfigPath), this.modConfig, 2);
            this.fileSystem.writeJson(path.join(__dirname, jsonRaidCachePath), this.raidCaches, 2);
        }
    }

    private routerRegister(): void {
        const staticRouterModService = RaidRecordMod.container.resolve<StaticRouterModService>("StaticRouterModService");

        staticRouterModService.registerStaticRouter(
            "Suntion.Server.raid.start",
            [
                {
                    "url": "/client/match/local/start",
                    "action": async (url, info, sessionId, output) =>
                        {
                            // this.recordPriceCache();
                            this.handleRaidStart(info, sessionId, output);
                            return output;
                        }
                }
            ],
            ""
        )
        staticRouterModService.registerStaticRouter(
            "Suntion.Server.raid.end",
            [
                {
                    "url": "/client/match/local/end",
                    "action": async (url, info, sessionId, output) =>
                        {
                            this.handleRaidEnd(info, sessionId, output);
                            return output;
                        }
                }
            ],
            ""
        )

        RaidRecordMod.container.afterResolution(
            "ItemHelper",
            (_, itemHelper: ItemHelper) => 
            {
                const ReplaceIDs = itemHelper.replaceIDs;
                itemHelper.replaceIDs = (beforeReplaceItems, pmcData, insuredItems, fastPanel) => 
                {
                    const results: IItem[] = ReplaceIDs.call(
                        itemHelper,
                        beforeReplaceItems,
                        pmcData,
                        insuredItems,
                        fastPanel
                    );

                    if (!pmcData || !this.raidCaches[pmcData._id]) {
                        return results;
                    }

                    const idReplaceMap: Record<string, string> = {};

                    for (let i = 0; i < beforeReplaceItems.length; i++) 
                    {
                        const oldId = beforeReplaceItems[i]._id;
                        const newId = results[i]._id;
                        idReplaceMap[oldId] = newId;
                    }

                    for (let raidInfo of Object.values(this.raidCaches[pmcData._id]).filter(x => x.state === "未归档" && x.playerId === pmcData._id)) {
                        this.raidCaches[pmcData._id][raidInfo.serverId] = updateRaidInfoByReplaceIDs(raidInfo, idReplaceMap);
                        this.info(`已更新来自${pmcData.Info.Nickname}对局${raidInfo.serverId}的ID变换`);
                    }

                    return results;
                };
            },
            { frequency: "Always" }
        );
    }

    private handleRaidStart(info, sessionId: string, output: string): void {
        let searchFriendResponse: ISearchFriendResponse = this.profileHelper.getChatRoomMemberFromSessionId(sessionId);
        let output_data = JSON.parse(output)
        let player_id: string = searchFriendResponse._id;
        let serverId: string = output_data.data.serverId;
        let pmcProfile: IPmcData = this.profileHelper.getProfileByPmcId(player_id);
        if (!this.raidCaches[player_id]) {
            this.raidCaches[player_id] = defaultJson();
        }
        if (!this.raidRecords[player_id]) {
            this.raidRecords[player_id] = defaultJson();
        }

        let cache: IRaidInfo[] = Object.values(this.raidCaches[player_id]);
        
        let hadEntered = cache.find(x => x.playerId == pmcProfile._id);
        if (hadEntered) {
            hadEntered.state = "中途退出";
            delete this.raidCaches[player_id][hadEntered.serverId];

            this.raidRecords[player_id][hadEntered.serverId] = archive2RaidInfoArchive(hadEntered, this.itemHelper, this.databaseService);
            this.fileSystem.writeJson(path.join(__dirname, jsonRaidRecordPath), this.raidRecords, 2);
            this.fileSystem.writeJson(path.join(__dirname, jsonRaidCachePath), this.raidCaches, 2);

            this.warn(`玩家${player_id}于对局${hadEntered.serverId}中中途退出`)
        }

        this.raidCaches[player_id][serverId] = {
            serverId: serverId,
            playerId: player_id,
            state: "未归档",
            raidInventoryBegin: null,
            raidInventoryEnd: null,
            addition: null,
            remove: null,
            used: null,
            entryValue: 0,
            equipmentValue: 0,
            securedValue: 0,
            grossProfit: 0,
            combatLosses: 0,
            createTime: Date.now(),
            eftStats: null,
            results: {
                exitName: null,
                favorite: false,
                inSession: false,
                killerAid: null,
                killerId: null,
                playTime: 0,
                result: null
            }
        }

        if (pmcProfile) {
            const raidInfo: IRaidInfo = this.raidCaches[player_id][serverId];
            raidInfo.raidInventoryBegin = loadInventoryInfo(pmcProfile.Inventory, this.itemHelper)
            const raidInventoryBegin: IItem[] = Object.values(raidInfo.raidInventoryBegin || {});
            raidInfo.entryValue = getItemsValueAll(raidInventoryBegin, this.itemHelper);
            raidInfo.equipmentValue = getItemsValueWithBaseClasses(
                raidInventoryBegin,
                this.equipments,
                this.itemHelper
            )
            raidInfo.securedValue = getItemsValueAll(
                getAllItemsInContainer(
                    'SecuredContainer',
                    raidInventoryBegin
                ), this.itemHelper
            )

            let msg = `${pmcProfile.Info.Nickname}(id=${player_id} sessionId=${sessionId})启动对局, 对局ID(${serverId})`
            msg += `\n\t突袭带入物品数量: ${getValidItemCount(Object.values(raidInfo.raidInventoryBegin || {}), this.itemHelper)} 入场价值: ${raidInfo.entryValue}rub(装备: ${raidInfo.equipmentValue}rub, 安全箱: ${raidInfo.securedValue}rub)`

            this.infoRaid(msg);

            this.fileSystem.writeJson(path.join(__dirname, jsonRaidCachePath), this.raidCaches, 2);
        } else {
            delete this.raidCaches[player_id][serverId];
            this.fileSystem.writeJson(path.join(__dirname, jsonRaidCachePath), this.raidCaches, 2);
            this.error(`sessionID ${sessionId} 未找到对应存档`)
        }
    }

    private handleRaidEnd(info, sessionId: string, output: string): void {
        let searchFriendResponse: ISearchFriendResponse = this.profileHelper.getChatRoomMemberFromSessionId(sessionId);
        let info_data = info;
        let player_id: string = info_data.results.profile._id;
        let serverId: string = info_data.serverId;
        let raidInfo: IRaidInfo = this.raidCaches[player_id]?.[serverId] ?? null;
        if (!this.raidCaches[player_id]) {
            this.raidCaches[player_id] = defaultJson();
        }
        if (!this.raidRecords[player_id]) {
            this.raidRecords[player_id] = defaultJson();
        }
        if (!raidInfo) {
            this.warn(`突袭${serverId}对于玩家${player_id}不存在`)
            try {
                raidInfo = {
                    serverId: info_data?.serverId ??  ('sandbox.' + this.hashUtil.generate()), // 实在没有服务ID就重新生成一个
                    playerId: info_data?.results?.profile?._id ?? null,
                    createTime: Date.now() - (info_data?.results?.playTime ?? 3600),
                    state: '推测对局',
                    raidInventoryBegin: {},
                    raidInventoryEnd: loadInventoryInfo(this.profileHelper.getProfileByPmcId(player_id)?.Inventory ?? null, this.itemHelper),
                    addition: null,
                    remove: null,
                    used: null,
                    entryValue: 0,
                    equipmentValue: 0, 
                    securedValue: 0,
                    grossProfit: 0,
                    combatLosses: 0,
                    eftStats: null,
                    results: {
                        result: null,
                        killerId: null,
                        killerAid: null,
                        exitName: null,
                        inSession: false,
                        favorite: false,
                        playTime: null
                    }
                }
            } catch (e) {
                this.error(`对局数据推测失败, 已放弃本局数据`)
                this.error(`名称: ${e?.name}\n\t消息: ${e?.message}\n\t堆栈: ${e?.stack}`)
                return;
            }
            
        }

        // 处理对局结果
        for (let name of Object.keys(raidInfo.results)) {
            raidInfo.results[name] = info_data.results[name] || null
        }
        let pmcProfile: IPmcData = this.profileHelper.getProfileByPmcId(player_id);
        let msg = '';
        if (pmcProfile) {
            msg += `${pmcProfile.Info.Nickname}(id=${player_id} sessionId=${sessionId})结束对局, 对局ID(${serverId})\n\t`

            raidInfo.raidInventoryEnd = loadInventoryInfo(pmcProfile.Inventory, this.itemHelper)
        } else {
            this.error(`sessionID ${sessionId} 未找到对应存档`);
            return;
        }
        raidInfo = archive2RaidInfo(raidInfo, pmcProfile, this.itemHelper);
        this.raidRecords[player_id][serverId] = archive2RaidInfoArchive(raidInfo, this.itemHelper, this.databaseService);
        
        delete this.raidCaches[player_id][serverId];
        this.fileSystem.writeJson(path.join(__dirname, jsonRaidCachePath), this.raidCaches, 2);
        this.fileSystem.writeJson(path.join(__dirname, jsonRaidRecordPath), this.raidRecords, 2);

        msg += `突袭带出物品数量: ${(raidInfo?.addition || []).length}\n\t`
        let msgResult = msg + `突袭${serverId}带出价值${raidInfo.grossProfit}卢布, 战损${raidInfo.combatLosses}卢布, 净利润${raidInfo.grossProfit - raidInfo.combatLosses}卢布`;
        
        const results: IRaidResultsData = info_data.results;
        const mapName: string = serverId.substring(0, serverId.indexOf('.')).toLowerCase();

        msgResult += `\n\t地图: ${mapNames[mapName]} 对局时间: ${timeString(results.playTime)}`
        msgResult += `\n\t入场价值: ${raidInfo.entryValue}rub(装备: ${raidInfo.equipmentValue}rub, 安全箱: ${raidInfo.securedValue}rub)`
        msgResult += `\n\t结果: ${resultNames[results.result] || results.result} 撤离点: ${results.exitName ?? '未撤离'}`
        if (this.modConfig.LogVictims) {
            const victims: IVictim[] = raidInfo.eftStats.Victims;
            if (victims.length > 0) {
                const locals: Record<string, string> = this.databaseService.getTables().locales.global['ch'];
                msgResult += `\n\t本局击杀:`
                for (const victim of victims) {
                    msgResult += `\n\t> 使用${locals[victim.Weapon] ?? '未知武器'}命中${victim.BodyPart}淘汰距离${victim.Distance}m远的${victim.Name}(等级:${victim.Level} 阵营:${victim.Side})`
                }
            }
        }
        this.infoRaid(msgResult)
    }

    // 被视为战备的基类(枪械, 胸挂, 背包, 护甲, 头盔等)
    equipments: BaseClasses[] = [
        BaseClasses.WEAPON,
        BaseClasses.UBGL,
        BaseClasses.ARMOR,
        BaseClasses.ARMORED_EQUIPMENT,
        BaseClasses.HEADWEAR,
        BaseClasses.FACECOVER,
        BaseClasses.VEST,
        BaseClasses.BACKPACK,
        BaseClasses.VISORS,
        BaseClasses.GAS_BLOCK,
        BaseClasses.RAIL_COVER,
        BaseClasses.MOD,
        BaseClasses.FUNCTIONAL_MOD,
        BaseClasses.GEAR_MOD,
        BaseClasses.STOCK,
        BaseClasses.FOREGRIP,
        BaseClasses.MASTER_MOD,
        BaseClasses.MOUNT,
        BaseClasses.MUZZLE,
        BaseClasses.SIGHTS,
        BaseClasses.ASSAULT_SCOPE,
        BaseClasses.TACTICAL_COMBO,
        BaseClasses.FLASHLIGHT,
        BaseClasses.MAGAZINE,
        BaseClasses.LIGHT_LASER_DESIGNATOR,
        BaseClasses.FLASH_HIDER,
        BaseClasses.COLLIMATOR,
        BaseClasses.IRON_SIGHT,
        BaseClasses.COMPACT_COLLIMATOR,
        BaseClasses.COMPENSATOR,
        BaseClasses.OPTIC_SCOPE,
        BaseClasses.SPECIAL_SCOPE,
        BaseClasses.SILENCER,
        BaseClasses.AUXILIARY_MOD,
        BaseClasses.BIPOD,
        BaseClasses.BUILT_IN_INSERTS,
        BaseClasses.ARMOR_PLATE,
        BaseClasses.HANDGUARD,
        BaseClasses.PISTOL_GRIP,
        BaseClasses.RECEIVER,
        BaseClasses.BARREL,
        BaseClasses.CHARGING_HANDLE,
        BaseClasses.COMB_MUZZLE_DEVICE,
        // 去掉储物箱, 可上锁容器, 简易容器, 固定容器
        // BaseClasses.STASH,
        // BaseClasses.LOCKABLE_CONTAINER,
        // BaseClasses.SIMPLE_CONTAINER,
        // BaseClasses.STATIONARY_CONTAINER
    ]
}

module.exports = { mod: new RaidRecordMod() }