import { IEftStats } from "@spt/models/eft/common/tables/IBotBase"
import { IRaidInfo, IRaidResultsData, updateRaidInfoByReplaceIDs, iitemQualityModify, copy } from "./raid"
import { ItemHelper } from "@spt/helpers/ItemHelper"
import { DatabaseService } from "@spt/services/DatabaseService"

// 压缩物品信息, 减少储存占用
export interface IItemArchive {
    id: string,
    tpl: string,
    modify: number // 0~n的倍率
}

// 压缩后对局的详细信息
export interface IRaidInfoArchive {
    serverId: string, // 对局ID
    playerId: string, // 参与的玩家ID
    createTime: number,
    state: string, // 已归档 | 中途退出 | 推测对局
    // 下面两个属性都是 { 物品实例id -> 物品实例 }
    raidInventoryBegin: Record<string, IItemArchive>, // 入局库存
    raidInventoryEnd: Record<string, IItemArchive>, // 撤离后的库存
    addition: string[], // 新获得的物品
    remove: string[], // 损失的物品
    used: string[], // 对局中使用了的物品
    entryValue: number, // 入场价值
    equipmentValue: number, // 装备价值(枪械, 弹挂, 背包, 配件)
    securedValue: number, // 安全箱物品总价值
    grossProfit: number, // 毛收益
    combatLosses: number, // 战损
    eftStats: IEftStats // 战局状态结果(包括详细击杀数据)
    results: IRaidResultsData  // 突袭实际结果
};

// { pmcId -> { serverId -> IRaidInfo } }
export interface IRaidInfoServerData {
    [key: string]: {
        [key: string]: IRaidInfo
    }
};

// { pmcId -> { serverId -> IRaidInfo } }
export interface IRaidInfoServerArchiveData {
    [key: string]: {
        [key: string]: IRaidInfoArchive
    }
};

/**
 * 压缩IRaidInfo信息, 不会重新计算入场价值, 对局消耗, 对局收益
 * @param raidInfo 
 * @param itemHelper 
 * @param databaseService 
 */
export function archive2RaidInfoArchive(raidInfo: IRaidInfo, itemHelper: ItemHelper, databaseService: DatabaseService): IRaidInfoArchive {
    if (!raidInfo || !itemHelper || !databaseService) { throw "参数意外为空" };
    if (!["已归档", "中途退出", "推测对局"].includes(raidInfo.state)) { throw "未归档对局记录无法压缩" }
    const raidInfoArchive: IRaidInfoArchive =  {
        serverId: raidInfo.serverId, 
        playerId: raidInfo.playerId,
        createTime: raidInfo.createTime,
        state: raidInfo.state,
        raidInventoryBegin: {},
        raidInventoryEnd: {},
        addition: [],
        remove: [],
        used: [],
        equipmentValue: raidInfo.equipmentValue,
        securedValue: raidInfo.securedValue,
        entryValue: raidInfo.entryValue,
        grossProfit: raidInfo.grossProfit,
        combatLosses: raidInfo.combatLosses,
        eftStats: raidInfo.eftStats,
        results: raidInfo.results
    }
    // id压缩(获取ID集合并构建变换字典) 压缩MognoId字符串长度
    const existIds: Set<string> = new Set<string>([
        ...Object.keys(raidInfo?.raidInventoryBegin || {}), 
        ...Object.keys(raidInfo?.raidInventoryEnd || {})
    ]);
    const replaceInfo = Object.fromEntries(
        Array.from(existIds).map((id, idx) => [id, String(idx)])
    );
    const raidInfoReplacedIds: IRaidInfo = updateRaidInfoByReplaceIDs(raidInfo, replaceInfo);
    // 物品信息压缩
    for (const item of Object.values(raidInfoReplacedIds?.raidInventoryBegin || {})) {
        if (!(item._id in raidInfoArchive.raidInventoryBegin)) {
            raidInfoArchive.raidInventoryBegin[item._id] = {
                id: item._id,
                tpl: item._tpl,
                modify: 0
            }
        }
        raidInfoArchive.raidInventoryBegin[item._id].modify += iitemQualityModify(item, itemHelper);
    }
    for (const item of Object.values(raidInfoReplacedIds?.raidInventoryEnd || {})) {
        if (!(item._id in raidInfoArchive.raidInventoryEnd)) {
            raidInfoArchive.raidInventoryEnd[item._id] = {
                id: item._id,
                tpl: item._tpl,
                modify: 0
            }
        }
        raidInfoArchive.raidInventoryEnd[item._id].modify += iitemQualityModify(item, itemHelper);
    }
    raidInfoArchive.addition = copy(raidInfoReplacedIds.addition);
    raidInfoArchive.remove = copy(raidInfoReplacedIds.remove);
    raidInfoArchive.used = copy(raidInfoReplacedIds.used);
    return raidInfoArchive;
}